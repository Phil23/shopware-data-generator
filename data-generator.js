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
        generateImages = true,
        generateReviews = true,
        productCount = 10,
        descriptionWordCount = 200
    ) {
        console.log(`Generating product data ...`);

        let schema = ProductDefinition;

        let prompt = `Create fake sample data for ${productCount} products of an online store in JSON format. 
                              The products should resemble fake items of the industry ${category}, but no real-world brands.
                              The product description should contain at least ${descriptionWordCount} words.`;

        if (generateReviews) {
            schema = ProductDefinition.extend({
                productReviews: z.array(ProductReviewDefinition),
            });

            prompt = `Create fake sample data for ${productCount} products of an online store in JSON format. 
                      The products should resemble fake items of the industry ${category}, but no real-world brands.
                      The product description should contain at least ${descriptionWordCount} words.
                      Each product should have at least five reviews.`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'gpt-4o-2024-08-06',
            response_format: zodResponseFormat(z.object({
                products: z.array(schema)
            }), 'products'),
        });

        let products = [];

        try {
            const parsedResponse = JSON.parse(completion.choices[0].message.content);
            products = parsedResponse.products;
        } catch(e) {
            console.error(e);
        }

        console.log(`Data for ${products.length} products was generated successfully.`);

        if (!generateImages) {
            return products;
        } else {
            return await this.generateProductImages(products, category);
        }
    }

    async generateProductImages(products, category) {
        console.log('Generating product images ...');

        const categoryImageDir = this.createCategoryImageDir(category);

        return await Promise.all(products.map(async (product) => {
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
        }));
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