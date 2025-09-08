import crypto from "node:crypto";
import axios, { type AxiosInstance } from "axios";

export class DataHydrator {
    public apiClient: AxiosInstance;
    public envPath: string | undefined;
    public authenticationType: string | undefined;

    private userName: string | undefined;
    private password: string | undefined;
    private apiClientId: string | undefined;
    private apiClientSecret: string | undefined;
    private apiClientAccessToken: string | null | undefined;

    constructor() {
        this.apiClient = axios.create();
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

        this.apiClient = axios.create({
            baseURL: `${this.envPath}/api/`,
        });

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
        this.apiClient.defaults.headers.common["Authorization"] =
            "Bearer " + this.apiClientAccessToken;
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

        this.apiClient = axios.create({
            baseURL: `${this.envPath}/api/`,
        });

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
        this.apiClient.defaults.headers.common["Authorization"] =
            "Bearer " + this.apiClientAccessToken;
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

    async createProductCategory(category: string, salesChannel: Record<string, any>) {
        const categoryName = this.capitalizeString(category.trim());

        const categorySearchResponse = await this.apiClient.post("search/category", {
            limit: 1,
            filter: [
                {
                    type: "equals",
                    field: "name",
                    value: categoryName,
                },
                {
                    type: "equals",
                    field: "parentId",
                    value: salesChannel.navigationCategoryId,
                },
            ],
        });

        if (categorySearchResponse.data.total === 1 && categorySearchResponse.data.data[0]) {
            return categorySearchResponse.data.data[0];
        }

        const categoryResponse = await this.apiClient.post("category?_response", {
            name: categoryName,
            parentId: salesChannel.navigationCategoryId,
            displayNestedProducts: true,
            type: "page",
            productAssignmentType: "product",
            visible: true,
            active: true,
        });

        return categoryResponse.data.data;
    }

    async hydrateEnvWithPropertyGroups(propertyGroups: Record<string, any>[]) {
        if (!this.apiClientAccessToken) {
            console.error("Client is not authenticated.");
            return [];
        }

        const propertyGroupsPayload = propertyGroups.map((group) => {
            return {
                id: this.createUUID(),
                name: group.name,
                description: group.description,
                displayType: group.displayType,
                options: group.options.map((option: Record<string, any>[]) => {
                    return {
                        id: this.createUUID(),
                        ...option,
                    };
                }),
            };
        });

        const propertyGroupResponse = await this.apiClient.post("_action/sync", {
            hydratePropertyGroups: {
                entity: "property_group",
                action: "upsert",
                payload: propertyGroupsPayload,
            },
        });

        console.log("Property Group Response", propertyGroupResponse.status);

        return propertyGroupsPayload;
    }

    async hydrateEnvWithProducts(
        products: Record<string, any>,
        category: string,
        salesChannelName: string = "Storefront",
    ) {
        if (!this.apiClientAccessToken) {
            console.error("Client is not authenticated.");
            return false;
        }

        const currencyId = await this.getCurrencyId();
        const taxId = await this.getStandardTaxId();
        const salesChannel = await this.getStandardSalesChannel(salesChannelName);

        const productCategory = await this.createProductCategory(category, salesChannel);

        const mediaUploads: Record<string, any> = [];
        const mediaPayload: Record<string, any> = [];
        const productPayload = products.map((p: Record<string, any>) => {
            const UUID = this.createUUID();

            const product: Record<string, any> = {
                id: UUID,
                productNumber: `AI-${UUID}`,
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
                        productId: UUID,
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
                const mediaId = this.createUUID();
                const productMediaId = this.createUUID();

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

        const productResponse = await this.apiClient.post("_action/sync", {
            hydrateProducts: {
                entity: "product",
                action: "upsert",
                payload: productPayload,
            },
            hydrateMedia: {
                entity: "media",
                action: "upsert",
                payload: mediaPayload,
            },
        });

        console.log("Product Create Response", productResponse.status);

        const mediaResponse = await Promise.all(
            mediaUploads.map(async (media: Record<string, any>) => {
                return await this.apiClient.post(
                    `_action/media/${media.id}/upload?extension=png&fileName=${media.image.name}-${media.id}`,
                    Buffer.from(media.image.data, "base64"),
                    {
                        headers: {
                            "Content-Type": "image/png",
                        },
                    },
                );
            }),
        );

        return productResponse.status;
    }
}
