import OpenAI from 'openai';
import fs from 'node:fs';
import crypto from 'node:crypto';
import axios from 'axios';

export class DataHydrator {

    constructor(openAiApiKey, imageDir = './generatedImages') {
        if (!openAiApiKey.length || openAiApiKey.length <= 0) {
            console.error('Missing API key for OpenAI.');
        }

        this.openAI = new OpenAI({
            apiKey: openAiApiKey
        });

        this.apiClient = axios.create();

        this.imageDir = imageDir;

        if (!fs.existsSync(this.imageDir)) {
            try {
                fs.mkdirSync(this.imageDir);
            } catch (err) {
                console.error(err);
            }
        }
    }

    createUUID() {
        return crypto.randomUUID().replace(/-/g, '');
    }

    capitalizeString(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    async authenticateWithClientCredentials(envPath, clientId, clientSecret) {
        let authResponse;

        this.envPath = envPath || 'http://localhost:8000';
        this.apiClientId = clientId;
        this.apiClientSecret = clientSecret;
        this.authenticationType = 'client';

        this.apiClient = axios.create({
            baseURL: `${this.envPath}/api/`
        });

        if (this.apiClientId && this.apiClientSecret) {
            authResponse = await this.apiClient.post('oauth/token', {
                grant_type: 'client_credentials',
                client_id: this.apiClientId,
                client_secret: this.apiClientSecret,
                scope: 'write',
            });
        } else {
            // Fallback for dev mode to standard admin user.
            authResponse = await this.apiClient.post('oauth/token', {
                client_id: 'administration',
                grant_type: 'password',
                username: 'admin',
                password: 'shopware',
                scope: 'write',
            });
        }

        if (!authResponse.data['access_token']) {
            console.error('Authentication failed.');
            console.log(authResponse);

            this.apiClientAccessToken = null;
            return false;
        }

        this.apiClientAccessToken = authResponse.data['access_token'];
        this.apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + this.apiClientAccessToken;
    }

    async authenticateWithUserCredentials(envPath, userName, password) {
        if (!userName || !password) {
            this.apiClientAccessToken = null;
            return false;
        }

        this.envPath = envPath || 'http://localhost:8000';
        this.userName = userName;
        this.password = password;
        this.authenticationType = 'user';

        this.apiClient = axios.create({
            baseURL: `${this.envPath}/api/`
        });

        const authResponse = await this.apiClient.post('oauth/token', {
            client_id: 'administration',
            grant_type: 'password',
            username: userName,
            password: password,
            scope: 'write',
        });

        if (!authResponse.data['access_token']) {
            this.apiClientAccessToken = null;
            return false;
        }

        this.apiClientAccessToken = authResponse.data['access_token'];
        this.apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + this.apiClientAccessToken;
        return true;
    }

    async getCurrencyId(currency = 'EUR') {
        const currencyResponse = await this.apiClient.post('search/currency', {
            limit: 1,
            filter: [{ type: 'equals', field: 'isoCode', value: currency }]
        });

        return currencyResponse.data.data[0].id;
    }

    async getStandardTaxId(){
        const taxResponse = await this.apiClient.post('search/tax', {
            limit: 1
        });

        return taxResponse.data.data[0].id;
    }

    async getStandardSalesChannel() {
        const salesChannelResponse = await this.apiClient.post('search/sales-channel', {
            limit: 1,
            filter: [{
                type: 'equals',
                field: 'name',
                value: 'Storefront'
            }]
        });

        return salesChannelResponse.data.data[0];
    }

    async createProductCategory(category, salesChannel) {
        const categoryName = this.capitalizeString(category.trim());

        const categorySearchResponse = await this.apiClient.post('search/category', {
            limit: 1,
            filter: [{
                type: 'equals',
                field: 'name',
                value: categoryName
            }, {
                type: 'equals',
                field: 'parentId',
                value: salesChannel.navigationCategoryId
            }]
        });

        if (categorySearchResponse.data.total === 1 && categorySearchResponse.data.data[0]) {
            return categorySearchResponse.data.data[0];
        }

        const categoryResponse = await this.apiClient.post('category?_response', {
            name: categoryName,
            parentId: salesChannel.navigationCategoryId,
            displayNestedProducts: true,
            type: 'page',
            productAssignmentType: 'product',
            visible: true,
            active: true
        });

        return categoryResponse.data.data;
    }

    createCategoryImageDir(category) {
        const categoryImageDir = `${this.imageDir}/${category.replace(/[^a-zA-Z]/g, '')}`;

        if (!fs.existsSync(categoryImageDir)) {
            try {
                fs.mkdirSync(categoryImageDir);
            } catch (err) {
                console.error(err);
            }
        }

        return categoryImageDir;
    }

    getProductDataScheme() {
        return {
            name: { type: 'string', description: 'The name of the product.' },
            description: { type: 'string', description: 'A text describing the features of the product with minimum 80 words.' },
            price: { type: 'float', description: 'The price of the product.' },
            stock: { type: 'integer', description: 'Indicates the number of products available.' }
        }
    }

    async generateProducts(category, productCount = 10) {
        console.log(`Generating product data ...`);

        const productScheme = this.getProductDataScheme();
        const prompt = `Create fake sample data for ${productCount} products of an online store in JSON format containing an array of objects. 
                              Each object should contain exactly the fields defined in this scheme ${JSON.stringify(productScheme)}. 
                              The products should resemble fake items of the industry ${category}, but no real-world brands.`

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'gpt-3.5-turbo',
            response_format: { type: 'json_object' }
        });

        let products = [];

        try {
            const parsedResponse = JSON.parse(completion.choices[0].message.content);
            products = parsedResponse.products;
        } catch(e) {
            console.error(e);
        }

        console.log(`Data for ${products.length} products was generated successfully.`);

        return await this.generateProductImages(products, category);
    }

    async generateProductImages(products, category) {
        console.log('Generating product images ...');

        const categoryImageDir = this.createCategoryImageDir(category);

        return await Promise.all(products.map(async (product) => {
            const imageName = product.name.replace(/[^a-zA-Z]/g, '');
            const imageFsPath= `${categoryImageDir}/${imageName}.png`;

            if (fs.existsSync(imageFsPath)) {
                const imageBase64 = fs.readFileSync(imageFsPath, { encoding: 'base64' });

                product.image = {
                    name: imageName,
                    type: '.png',
                    data: imageBase64
                };

                return product;
            }

            // const prompt= `Create a fake product image for an online store which shows a realistic separated product on a white background without text
            //                      that matches the name: ${product.name} and description: ${product.description}.`;
            const prompt= `Create a photo-realistic fake product image separated on a white background without text or other elements 
                                 that matches the name ${product.name} from the category ${category}.`;

            let imageBase64 = '';

            try {
                const imageResponse= await this.openAI.images.generate({
                    model: 'dall-e-3',
                    prompt: prompt,
                    size: '1024x1024',
                    response_format: 'b64_json',
                    n: 1
                });
                imageBase64= imageResponse.data[0]['b64_json'];
            } catch (e) {
                console.warn(e);
            }

            if (!imageBase64.length > 0) {
                return product;
            }

            if (!fs.existsSync(imageFsPath)) {
                try {
                    fs.writeFileSync(imageFsPath, imageBase64, 'base64', { flag: 'a' });
                } catch (err) {
                    console.error(err);
                }
            } else {
                console.warn('Image already exists.');
            }

            console.log(`Image for product ${product.name} generated successfully.`);

            product.image = {
                name: imageName,
                type: '.png',
                data: imageBase64
            };

            return product;
        }));
    }

    async generateLogo(category) {
        const categoryImageDir = this.createCategoryImageDir(category);

        const imageName = `logo-${category.replace(/[^a-zA-Z]/g, '')}`;
        const imageFsPath= `${categoryImageDir}/${imageName}.png`;

        const prompt = `An emblem for a fake ${category} brand including the text "${category}", horizontal, clean, simple, vector, pure white #ffffff background.`

        const imageResponse= await this.openAI.images.generate({
            model: 'dall-e-3',
            prompt: prompt,
            size: '1024x1024',
            response_format: 'b64_json',
            n: 1
        });
        const imageBase64= imageResponse.data[0]['b64_json'];

        if (!fs.existsSync(imageFsPath)) {
            try {
                fs.writeFileSync(imageFsPath, imageBase64, 'base64', { flag: 'a' });
            } catch (err) {
                console.error(err);
            }
        } else {
            console.warn('Image already exists.');
        }

        return {
            imageName: imageName,
            image: imageBase64,
            type: '.png'
        };
    }

    async hydrateEnvWithLogo(logoImage) {
        if (!this.apiClientAccessToken) {
            console.error('Client is not authenticated.');
            return false;
        }

        const salesChannel = await this.getStandardSalesChannel();

        console.log(salesChannel);
    }

    async hydrateEnvWithProducts(products, category) {
        if (!this.apiClientAccessToken) {
            console.error('Client is not authenticated.');
            return false;
        }

        const currencyId = await this.getCurrencyId();
        const taxId = await this.getStandardTaxId();
        const salesChannel = await this.getStandardSalesChannel();

        const productCategory = await this.createProductCategory(category, salesChannel);

        const mediaUploads = [];
        const mediaPayload = [];
        const productPayload = products.map((p) => {
            const UUID = this.createUUID();

            const product = {
                id: UUID,
                productNumber: `AI-${UUID}`,
                name: p.name,
                description: p.description,
                stock: p.stock,
                taxId: taxId,
                price: [{
                    currencyId: currencyId,
                    gross: p.price,
                    net: p.price,
                    linked: true
                }],
                visibilities: [{
                    productId: UUID,
                    salesChannelId: salesChannel.id,
                    visibility: 30
                }],
                categories: [{
                    id: salesChannel.navigationCategoryId
                }, {
                    id: productCategory.id
                }]
            }

            if (p.image) {
                const mediaId = this.createUUID();
                const productMediaId = this.createUUID();

                mediaUploads.push({
                    id: mediaId,
                    image: p.image
                });

                mediaPayload.push({
                    id: mediaId,
                    private: false
                });

                product.coverId = productMediaId;
                product.media = [{
                    id: productMediaId,
                    media: {
                        id: mediaId
                    },
                }];
            }

            return product;
        });

        const productResponse = await this.apiClient.post('_action/sync', {
            'hydrateProducts': {
                entity: 'product',
                action: 'upsert',
                payload: productPayload
            },
            'hydrateMedia': {
                entity: 'media',
                action: 'upsert',
                payload: mediaPayload
            }
        });

        console.log('Product Create Response', productResponse.status);

        const mediaResponse = await Promise.all(mediaUploads.map(async (media) => {
            return await this.apiClient.post(
                `_action/media/${media.id}/upload?extension=png&fileName=${media.image.name}-${media.id}`,
                Buffer.from(media.image.data, 'base64'),
                {
                    headers: {
                        'Content-Type': 'image/png'
                    }
                }
            );
        }));

        return productResponse.status;
    }
}
