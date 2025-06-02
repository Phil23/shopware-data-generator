import type { HttpClient } from "@shopware-ag/app-server-sdk";
import {
    EntityRepository,
    SyncOperation,
    SyncService,
} from "@shopware-ag/app-server-sdk/helper/admin-api";
import { Criteria } from "@shopware-ag/app-server-sdk/helper/criteria";
import {
    createMediaFolder,
    uploadMediaFile,
    getMediaFolderByName,
} from "@shopware-ag/app-server-sdk/helper/media";
import crypto from "node:crypto";
import util from "node:util";

export async function getCurrencyId(httpClient: HttpClient, currencyIsoCode = "EUR") {
    const currencyRepository = new EntityRepository(httpClient, "currency");
    const criteria = new Criteria();

    criteria.addFilter({
        type: "equals",
        field: "isoCode",
        value: currencyIsoCode,
    });

    const currencyResponse = await currencyRepository.search(criteria);
    const currency = currencyResponse.first() as Record<string, any>;

    return currency?.id;
}

export async function getStandardTaxId(httpClient: HttpClient) {
    const taxRepository = new EntityRepository(httpClient, "tax");
    const criteria = new Criteria();

    criteria.addFilter({
        type: "equals",
        field: "position",
        value: 1,
    });
    criteria.limit = 1;

    const taxResponse = await taxRepository.search(criteria);
    const tax = taxResponse.first() as Record<string, any>;

    return tax?.id;
}

export async function getStandardSalesChannel(httpClient: HttpClient) {
    const salesChannelRepository = new EntityRepository(httpClient, "sales_channel");
    const criteria = new Criteria();

    criteria.addFilter({
        type: "equals",
        field: "name",
        value: "Storefront",
    });
    criteria.limit = 1;

    const salesChannelResponse = await salesChannelRepository.search(criteria);

    return salesChannelResponse.first() as Record<string, any>;
}

export async function createProductCategory(
    httpClient: HttpClient,
    category: string,
    salesChannel: Record<string, any>,
) {
    const categoryName = capitalizeString(category);
    const categoryRepository = new EntityRepository(httpClient, "category");
    const criteria = new Criteria();

    criteria.addFilter({
        type: "equals",
        field: "name",
        value: categoryName,
    });

    const categoryResponse = await categoryRepository.search(criteria);

    if (categoryResponse.total === 1 && categoryResponse.data[0]) {
        return categoryResponse.data[0];
    }

    const categoryData = {
        id: createUUID(),
        name: categoryName,
        parentId: salesChannel.navigationCategoryId,
        displayNestedProducts: true,
        type: "page",
        productAssignmentType: "product",
        visible: true,
        active: true,
    };

    await categoryRepository.upsert([categoryData]);

    return categoryData;
}

export async function createPropertyGroups(
    httpClient: HttpClient,
    propertyGroups: Record<string, any>,
) {
    const syncService = new SyncService(httpClient);

    const propertyGroupsPayload = propertyGroups.map((group: Record<string, any>) => {
        return {
            id: createUUID(),
            name: group.name,
            description: group.description,
            displayType: group.displayType,
            options: group.options.map((option: Record<string, any>[]) => {
                return {
                    id: createUUID(),
                    ...option,
                };
            }),
        };
    });

    await syncService.sync([
        new SyncOperation(
            "CreatePropertyGroups",
            "property_group",
            "upsert",
            propertyGroupsPayload,
        ),
    ]);

    return propertyGroupsPayload;
}

export async function createProducts(
    httpClient: HttpClient,
    products: Record<string, any>,
    salesChannel: Record<string, any>,
    productCategory: Record<string, any>,
) {
    const syncService = new SyncService(httpClient);

    const currencyId = await getCurrencyId(httpClient);
    const taxId = await getStandardTaxId(httpClient);

    if (!currencyId || !taxId || !salesChannel?.id || !productCategory?.id) {
        console.error(
            "Required IDs are missing: currencyId, taxId, salesChannel.id, or productCategory.id",
        );
        return false;
    }

    const mediaUploads: object[] = [];
    const mediaPayload: object[] = [];

    const productPayload = products.map((p: Record<string, any>) => {
        const productUUID = createUUID();

        const product: Record<string, any> = {
            id: productUUID,
            productNumber: `DEMO-${productUUID}`,
            name: p.name,
            description: p.description,
            stock: p.stock,
            taxId: taxId,
            price: [
                {
                    currencyId: currencyId,
                    gross: p.price,
                    net: p.price,
                    linked: true,
                },
            ],
            visibilities: [
                {
                    productId: productUUID,
                    salesChannelId: salesChannel.id,
                    visibility: 30,
                },
            ],
            categories: [
                {
                    id: salesChannel.navigationCategoryId,
                },
                {
                    id: productCategory.id,
                },
            ],
        };

        if (p.productReviews) {
            product.productReviews = p.productReviews.map((review: Record<string, any>) => {
                review.salesChannelId = salesChannel.id;
                return review;
            });
        }

        if (p.options) {
            product.properties = p.options.map((option: Record<string, any>) => {
                return {
                    id: option.id,
                };
            });
        }

        if (p.image) {
            const mediaId = createUUID();
            const productMediaId = createUUID();

            mediaUploads.push({
                id: mediaId,
                image: p.image,
            });

            mediaPayload.push({
                id: mediaId,
                private: false,
            });

            product.coverId = productMediaId;
            product.media = [
                {
                    id: productMediaId,
                    media: {
                        id: mediaId,
                    },
                },
            ];
        }

        return product;
    });

    const productResponse = await syncService.sync([
        new SyncOperation("CreateProducts", "product", "upsert", productPayload),
        new SyncOperation("CreateMedia", "media", "upsert", mediaPayload),
    ]);

    const mediaResponse = await Promise.all(
        mediaUploads.map(async (media: Record<string, any>) => {
            return await httpClient.post(
                `/_action/media/${media.id}/upload?extension=png&fileName=${media.image.name}-${media.id}`,
                new Blob([Buffer.from(media.image.data, "base64")], { type: "image/png" }),
                {
                    "Content-Type": "image/png",
                },
            );
        }),
    );

    return true;
}

export function createUUID() {
    return crypto.randomUUID().replace(/-/g, "");
}

export function capitalizeString(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
