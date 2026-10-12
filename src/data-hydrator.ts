import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpClient } from "./http-client.js";

export type SavedPayload = {
    version: 1;
    createdAt: string;
    category: string;
    salesChannelName?: string;
    sync: Record<string, any>;
    mediaUploads: { id: string; file: string; fileName: string; extension: string }[];
};

export class DataHydrator {
    public apiClient: HttpClient;
    public envPath: string | undefined;
    public authenticationType: string | undefined;

    private userName: string | undefined;
    private password: string | undefined;
    private apiClientId: string | undefined;
    private apiClientSecret: string | undefined;
    private apiClientAccessToken: string | null | undefined;

    constructor() {
        this.apiClient = new HttpClient();
    }

    createUUID() {
        return crypto.randomUUID().replace(/-/g, "");
    }

    capitalizeString(s: string) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    async authenticateWithClientCredentials(
        envPath: string,
        clientId: string | undefined,
        clientSecret: string | undefined,
    ) {
        let authResponse;

        this.envPath = envPath || "http://localhost:8000";
        this.apiClientId = clientId;
        this.apiClientSecret = clientSecret;
        this.authenticationType = "client";

        this.apiClient = new HttpClient(`${this.envPath}/api/`);

        if (this.apiClientId && this.apiClientSecret) {
            authResponse = await this.apiClient.post("oauth/token", {
                grant_type: "client_credentials",
                client_id: this.apiClientId,
                client_secret: this.apiClientSecret,
                scope: "write",
            });
        } else {
            // Fallback for dev mode to standard admin user.
            authResponse = await this.apiClient.post("oauth/token", {
                client_id: "administration",
                grant_type: "password",
                username: "admin",
                password: "shopware",
                scope: "write",
            });
        }

        if (!authResponse.data["access_token"]) {
            console.error("Authentication failed.");
            console.log(authResponse);

            this.apiClientAccessToken = null;
            return false;
        }

        this.apiClientAccessToken = authResponse.data["access_token"];
        this.apiClient.setHeader("Authorization", `Bearer ${this.apiClientAccessToken}`);
        return true;
    }

    async authenticateWithUserCredentials(envPath: string, userName: string, password: string) {
        if (!userName || !password) {
            this.apiClientAccessToken = null;
            return false;
        }

        this.envPath = envPath || "http://localhost:8000";
        this.userName = userName;
        this.password = password;
        this.authenticationType = "user";

        this.apiClient = new HttpClient(`${this.envPath}/api/`);

        const authResponse = await this.apiClient.post("oauth/token", {
            client_id: "administration",
            grant_type: "password",
            username: userName,
            password: password,
            scope: "write",
        });

        if (!authResponse.data["access_token"]) {
            this.apiClientAccessToken = null;
            return false;
        }

        this.apiClientAccessToken = authResponse.data["access_token"];
        this.apiClient.setHeader("Authorization", `Bearer ${this.apiClientAccessToken}`);
        return true;
    }

    async getCurrencyId(currency = "EUR") {
        const currencyResponse = await this.apiClient.post("search/currency", {
            limit: 1,
            filter: [{ type: "equals", field: "isoCode", value: currency }],
        });

        return currencyResponse.data.data[0].id;
    }

    async getStandardTaxId() {
        const taxResponse = await this.apiClient.post("search/tax", {
            limit: 1,
        });

        return taxResponse.data.data[0].id;
    }

    async getStandardSalesChannel(salesChannelName: string = "Storefront") {
        const salesChannelResponse = await this.apiClient.post("search/sales-channel", {
            limit: 1,
            filter: [
                {
                    type: "equals",
                    field: "name",
                    value: salesChannelName,
                },
            ],
        });

        return salesChannelResponse.data.data[0];
    }

    createPropertyGroupsPayload(propertyGroups: Record<string, any>[]) {
        return propertyGroups.map((group) => ({
            id: this.createUUID(),
            name: group.name,
            description: group.description,
            displayType: group.displayType,
            options: group.options.map((option: Record<string, any>) => ({
                id: this.createUUID(),
                ...option,
            })),
        }));
    }

    async createSavedPayload(
        propertyGroups: Record<string, any>[],
        products: Record<string, any>[],
        category: string,
        salesChannelName: string = "Storefront",
    ): Promise<SavedPayload> {
        if (!this.apiClientAccessToken) {
            throw new Error("Client is not authenticated.");
        }

        const taxId = await this.getStandardTaxId();
        const salesChannel = await this.getStandardSalesChannel(salesChannelName);
        const currencyId = salesChannel.currencyId || (await this.getCurrencyId());
        const categoryName = this.capitalizeString(category.trim());
        const categorySearchResponse = await this.apiClient.post("search/category", {
            limit: 1,
            filter: [
                { type: "equals", field: "name", value: categoryName },
                { type: "equals", field: "parentId", value: salesChannel.navigationCategoryId },
            ],
        });
        const existingCategory = categorySearchResponse.data.data[0];
        const productCategory = existingCategory
            ? { id: existingCategory.id }
            : {
                  id: this.createUUID(),
                  name: categoryName,
                  parentId: salesChannel.navigationCategoryId,
                  displayNestedProducts: true,
                  type: "page",
                  productAssignmentType: "product",
                  visible: true,
                  active: true,
              };

        const mediaUploads: SavedPayload["mediaUploads"] = [];
        const productPayload = products.map((p) => {
            const id = this.createUUID();
            const product: Record<string, any> = {
                id,
                productNumber: `AI-${id}`,
                name: p.name,
                description: p.description,
                stock: p.stock,
                taxId,
                price: [{ currencyId, gross: p.price, net: p.price, linked: true }],
                visibilities: [{ productId: id, salesChannelId: salesChannel.id, visibility: 30 }],
                categories: [{ id: salesChannel.navigationCategoryId }, { id: productCategory.id }],
            };

            if (p.productReviews) {
                product.productReviews = p.productReviews.map((review: Record<string, any>) => ({
                    ...review,
                    salesChannelId: salesChannel.id,
                }));
            }
            if (p.options)
                product.properties = p.options.map((option: Record<string, any>) => ({
                    id: option.id,
                }));

            if (p.image) {
                const mediaId = this.createUUID();
                const productMediaId = this.createUUID();
                const imageFile = path.join(
                    "generatedImages",
                    category.replace(/[^a-zA-Z]/g, ""),
                    `${p.image.name}${p.image.type}`,
                );
                fs.mkdirSync(path.dirname(imageFile), { recursive: true });
                if (!fs.existsSync(imageFile)) {
                    fs.writeFileSync(imageFile, p.image.data, "base64");
                }
                mediaUploads.push({
                    id: mediaId,
                    file: imageFile,
                    fileName: `${p.image.name}-${mediaId}`,
                    extension: p.image.type.replace(/^\./, ""),
                });
                product.coverId = productMediaId;
                product.media = [{ id: productMediaId, media: { id: mediaId } }];
            }
            return product;
        });

        const sync: Record<string, any> = {};
        if (!existingCategory) {
            sync["hydrateCategory"] = {
                entity: "category",
                action: "upsert",
                payload: [productCategory],
            };
        }
        Object.assign(sync, {
            hydratePropertyGroups: {
                entity: "property_group",
                action: "upsert",
                payload: propertyGroups,
            },
            hydrateProducts: { entity: "product", action: "upsert", payload: productPayload },
            hydrateMedia: {
                entity: "media",
                action: "upsert",
                payload: mediaUploads.map(({ id }) => ({ id, private: false })),
            },
        });

        return {
            version: 1,
            createdAt: new Date().toISOString(),
            category,
            salesChannelName,
            sync,
            mediaUploads,
        };
    }

    async applySavedPayload(payload: SavedPayload) {
        if (!this.apiClientAccessToken) throw new Error("Client is not authenticated.");
        if (payload.version !== 1)
            throw new Error(`Unsupported payload version: ${payload.version}`);

        // Saved payloads may be applied to another Shopware installation, where
        // built-in IDs (navigation category, sales channel, tax and currency) differ.
        const sync = structuredClone(payload.sync);
        const salesChannel = await this.getStandardSalesChannel(
            payload.salesChannelName || "Storefront",
        );
        const taxId = await this.getStandardTaxId();
        const currencyId = salesChannel.currencyId || (await this.getCurrencyId());
        const oldNavigationCategoryId =
            sync.hydrateCategory?.payload?.[0]?.parentId ??
            sync.hydrateProducts?.payload?.[0]?.categories?.[0]?.id;
        const categoryName = this.capitalizeString(payload.category.trim());
        const categorySearchResponse = await this.apiClient.post("search/category", {
            limit: 1,
            filter: [
                { type: "equals", field: "name", value: categoryName },
                { type: "equals", field: "parentId", value: salesChannel.navigationCategoryId },
            ],
        });
        const existingCategory = categorySearchResponse.data.data[0];
        const savedCategoryId =
            sync.hydrateCategory?.payload?.[0]?.id ??
            sync.hydrateProducts?.payload?.[0]?.categories?.[1]?.id;
        const targetCategoryId = existingCategory?.id || savedCategoryId;

        if (sync.hydrateCategory?.payload?.length) {
            if (existingCategory) {
                delete sync.hydrateCategory;
            } else {
                sync.hydrateCategory.payload[0].parentId = salesChannel.navigationCategoryId;
            }
        }

        for (const product of sync.hydrateProducts?.payload || []) {
            product.taxId = taxId;
            product.visibilities = (product.visibilities || []).map(
                (visibility: Record<string, any>) => ({
                    ...visibility,
                    salesChannelId: salesChannel.id,
                }),
            );
            product.price = (product.price || []).map((price: Record<string, any>) => ({
                ...price,
                currencyId,
            }));
            product.categories = (product.categories || []).map(
                (category: Record<string, any>) => ({
                    id:
                        category.id === oldNavigationCategoryId
                            ? salesChannel.navigationCategoryId
                            : targetCategoryId,
                }),
            );
        }

        const response = await this.apiClient.post("_action/sync", sync);
        console.log("Sync Payload Response", response.status);

        for (const media of payload.mediaUploads) {
            const imagePath = path.resolve(media.file);
            if (!fs.existsSync(imagePath)) throw new Error(`Image file is missing: ${imagePath}`);
            await this.apiClient.post(
                `_action/media/${media.id}/upload?extension=${encodeURIComponent(media.extension)}&fileName=${encodeURIComponent(media.fileName)}`,
                fs.readFileSync(imagePath),
                { headers: { "Content-Type": `image/${media.extension}` } },
            );
        }
        return response.status;
    }
}
