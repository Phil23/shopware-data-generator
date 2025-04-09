import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
    ProductDefinition,
    ProductReviewDefinition,
    PropertyGroupDefinition,
} from './entities.js'

export class DataGenerator {

    constructor(openAiApiKey, imageDir = './generatedImages') {
        if (!openAiApiKey.length || openAiApiKey.length <= 0) {
            console.error('Missing API key for OpenAI.');
        }

        this.openAI = new OpenAI({
            apiKey: openAiApiKey
        });

        this.imageDir = imageDir;

        if (!fs.existsSync(this.imageDir)) {
            try {
                fs.mkdirSync(this.imageDir);
            } catch (err) {
                console.error(err);
            }
        }
    }

    async generatePropertyGroups(category, groupCount = 2) {
        console.log('Generating property group data ...');

        const prompt = `Create fake sample data for ${groupCount} product property groups in JSON format 
                              that could describe the properties of products of the industry ${category}.`;

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'gpt-4o-2024-08-06',
            response_format: zodResponseFormat(z.object({
                propertyGroups: z.array(PropertyGroupDefinition)
            }), 'propertyGroups'),
        });

        try {
            const parsedResponse = JSON.parse(completion.choices[0].message.content);
            return parsedResponse['propertyGroups'];
        } catch(e) {
            console.error(e);
        }
    }

    async generateProducts(
        category,
        productCount = 10,
        propertyGroups = null,
        generateImages = true,
        generateReviews = true,
        descriptionWordCount = 200
    ) {
        console.log(`Generating product data ...`);

        const productRequests = [];

        for (let i = 0; i < productCount; i++) {
            productRequests.push(
                this.generateProduct(category, propertyGroups, generateImages, generateReviews, descriptionWordCount)
            );
        }

        const products = await Promise.all(productRequests);

        if (!generateImages) {
            return products;
        } else {
            return await this.generateProductImages(products, category);
        }
    }

    async generateProduct(
        category,
        propertyGroups = null,
        generateImages = true,
        generateReviews = true,
        descriptionWordCount = 200
    ) {
        let schema = ProductDefinition;

        let prompt = `Create fake sample data for a product of an online store in JSON format. 
                             The product should resemble a fake item of the industry ${category}, but not from real-world brands.
                             The product description should contain at least ${descriptionWordCount} words.`;

        if (generateReviews) {
            schema = schema.extend({
                productReviews: z.array(ProductReviewDefinition),
            });

            prompt = `${prompt} The product should have at least five reviews with points between 1 and 5.`;
        }

        if (propertyGroups) {
            const options = [];

            propertyGroups.forEach((group) => {
                group.options.forEach((option) => {
                    options.push(option.id);
                });
            });

            schema = schema.extend({
                options: z.array(z.object({
                    id: z.enum(options),
                })),
            });

            prompt = `${prompt} The product should have at least two randomly chosen options from the possible options.`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'gpt-4o-2024-08-06',
            response_format: zodResponseFormat(schema, 'product'),
        });

        try {
            return JSON.parse(completion.choices[0].message.content);
        } catch(e) {
            console.error(e);
        }
    }

    async generateProductImages(products, category) {
        console.log('Generating product images ...');

        return await Promise.all(products.map(async (product) => {
            return await this.generateProductImage(product, category);
        }));
    }

    async generateProductImage(product, category) {
        const categoryImageDir = this.createCategoryImageDir(category);

        const imageName = product.name.replace(/[^a-zA-Z]/g, '');
        const imageFsPath= path.join(categoryImageDir, `${imageName}.png`);

        if (fs.existsSync(imageFsPath)) {
            const imageBase64 = fs.readFileSync(imageFsPath, { encoding: 'base64' });

            product.image = {
                name: imageName,
                type: '.png',
                data: imageBase64
            };

            console.log(`Image for product ${product.name} used from image cache.`);

            return product;
        }

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
        }

        console.log(`Image for product ${product.name} generated successfully.`);

        product.image = {
            name: imageName,
            type: '.png',
            data: imageBase64
        };

        return product;
    }

    async generateLogo(category) {
        const imageName = `logo-${category.replace(/[^a-zA-Z]/g, '')}`;
        const prompt = `An emblem for a fake ${category} brand including the text "${category}", horizontal, clean, simple, vector, pure white #ffffff background.`

        const imageResponse= await this.openAI.images.generate({
            model: 'dall-e-3',
            prompt: prompt,
            size: '1024x1024',
            response_format: 'b64_json',
            n: 1
        });
        const imageBase64= imageResponse.data[0]['b64_json'];

        return {
            imageName: imageName,
            image: imageBase64,
            type: '.png'
        };
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
}