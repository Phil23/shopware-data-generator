import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ProductDefinition, ProductReviewDefinition, PropertyGroupDefinition } from "./entities.js";

const ProductConceptDefinition = z.object({
    name: z.string(),
    concept: z.string(),
});

type ProductConcept = z.infer<typeof ProductConceptDefinition>;

export const TEXT_GENERATION_MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;
export type TextGenerationModel = (typeof TEXT_GENERATION_MODELS)[number];

export class DataGenerator {
    public readonly openAI: OpenAI;
    public readonly imageDir: string;
    public readonly textModel: TextGenerationModel;

    constructor(
        openAiApiKey: string,
        imageDir = "./generatedImages",
        textModel: TextGenerationModel = "gpt-6-luna",
    ) {
        if (!openAiApiKey.length || openAiApiKey.length <= 0) {
            console.error("Missing API key for OpenAI.");
        }

        this.openAI = new OpenAI({
            apiKey: openAiApiKey,
        });

        this.imageDir = imageDir;
        this.textModel = textModel;

        if (!fs.existsSync(this.imageDir)) {
            try {
                fs.mkdirSync(this.imageDir);
            } catch (err) {
                console.error(err);
            }
        }
    }

    async generatePropertyGroups(category: string, groupCount = 2) {
        console.log("Generating property group data ...");

        const prompt = `Create realistic sample data for ${groupCount} product property groups in JSON format 
                              that could describe the properties of products of the industry ${category}.`;

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: this.textModel,
            response_format: zodResponseFormat(
                z.object({
                    propertyGroups: z.array(PropertyGroupDefinition),
                }),
                "propertyGroups",
            ),
        });

        try {
            if (completion.choices[0]?.message.content) {
                const parsedResponse = JSON.parse(completion.choices[0].message.content);
                const propertyGroups = parsedResponse["propertyGroups"];

                for (const group of propertyGroups) {
                    for (const option of group.options) {
                        if (option.colorHexCode === null) {
                            delete option.colorHexCode;
                        }
                    }
                }

                return propertyGroups;
            } else {
                return [];
            }
        } catch (e) {
            console.error(e);
        }
    }

    async generateProducts(
        category: string,
        productCount = 10,
        propertyGroups: Record<string, any> | null = null,
        generateImages = true,
        generateReviews = true,
        descriptionWordCount = 200,
        additionalInformation: string = "",
    ) {
        console.log(`Generating product data ...`);

        if (productCount <= 0) {
            return [];
        }

        const productConcepts = await this.generateProductConcepts(
            category,
            productCount,
            additionalInformation,
        );

        const productRequests = productConcepts.map((productConcept) =>
            this.generateProduct(
                category,
                propertyGroups,
                generateReviews,
                descriptionWordCount,
                additionalInformation,
                productConcept,
            ),
        );

        const products = await Promise.all(productRequests);

        if (!generateImages) {
            return products;
        } else {
            return await this.generateProductImages(products, category, additionalInformation);
        }
    }

    async generateProductConcepts(
        category: string,
        productCount: number,
        additionalInformation = "",
    ): Promise<ProductConcept[]> {
        console.log(`Generating ${productCount} distinct product concepts ...`);

        let prompt = `Create exactly ${productCount} distinct product concepts for an online store in the industry ${category}. Do not use real-world brands. Every concept must have a unique, appealing product name and a short description of what makes that product distinct from the others. Return varied product types, ingredients, features, or use cases instead of repeating the same basic product with different names.`;

        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Use this additional context where relevant: "${additionalInformation}".`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: this.textModel,
            response_format: zodResponseFormat(
                z.object({
                    products: z.array(ProductConceptDefinition).length(productCount),
                }),
                "product_concepts",
            ),
        });

        try {
            const content = completion.choices[0]?.message.content;
            if (!content) {
                return [];
            }

            const { products } = JSON.parse(content) as { products: ProductConcept[] };
            const normalizedNames = products.map((product) =>
                product.name.trim().toLocaleLowerCase(),
            );
            if (new Set(normalizedNames).size !== products.length) {
                throw new Error("The generated product concepts contain duplicate names.");
            }

            return products;
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    async generateProduct(
        category: string,
        propertyGroups: Record<string, any> | null = null,
        generateReviews = true,
        descriptionWordCount = 200,
        additionalInformation: string = "",
        productConcept?: ProductConcept,
    ) {
        let schema = ProductDefinition;

        let prompt = `Create realistic sample data for a product of an online store in JSON format. 
                      The product should resemble a realistic item of the industry ${category}, but not from real-world brands.
                      The product description should contain at least ${descriptionWordCount} words. You can use simple html to format the description.`;

        if (productConcept) {
            prompt = `${prompt} The product must use the exact name "${productConcept.name}" and follow this distinct concept: ${productConcept.concept}. Do not replace it with a different product or name.`;
        }

        if (generateReviews) {
            schema = schema.extend({
                productReviews: z.array(ProductReviewDefinition),
            });

            prompt = `${prompt} The product should have at least five realistic reviews with points between 1 and 5.`;
        }

        if (propertyGroups) {
            const options: string[] = [];

            propertyGroups.forEach((group: Record<string, any>) => {
                group.options.forEach((option: Record<string, any>) => {
                    options.push(option.id);
                });
            });

            schema = schema.extend({
                options: z.array(
                    z.object({
                        id: z.enum(options as [string, ...string[]]),
                    }),
                ),
            });

            prompt = `${prompt} The product should have at least two fitting options from the possible options.`;
        }

        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Consider the following additional context for the product and its description: \"${additionalInformation}\".`;
        }

        const completion = await this.openAI.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: this.textModel,
            response_format: zodResponseFormat(schema, "product"),
        });

        try {
            if (completion.choices[0]?.message.content) {
                const product = JSON.parse(completion.choices[0].message.content);
                if (productConcept) {
                    product.name = productConcept.name;
                }
                return product;
            }
        } catch (e) {
            console.error(e);
        }
    }

    async generateProductImages(
        products: Record<string, any>[],
        category: string,
        additionalInformation: string = "",
    ) {
        console.log("Generating product images ...");

        return await Promise.all(
            products.map(async (product) => {
                return await this.generateProductImage(product, category, additionalInformation);
            }),
        );
    }

    async generateProductImage(
        product: Record<string, any>,
        category: string,
        additionalInformation: string = "",
    ) {
        const categoryImageDir = this.createCategoryImageDir(category);

        const imageName = product.name.replace(/[^a-zA-Z]/g, "");
        const imageFsPath = path.join(categoryImageDir, `${imageName}.png`);

        if (fs.existsSync(imageFsPath)) {
            const imageBase64 = fs.readFileSync(imageFsPath, { encoding: "base64" });

            product.image = {
                name: imageName,
                type: ".png",
                data: imageBase64,
            };

            console.log(`Image for product ${product.name} used from image cache.`);

            return product;
        }

        let prompt = `CRITICAL INSTRUCTION: Create a professional, commercial studio photograph of a photo-realistic product image. The image must be on a pristine white background with a clean, hard-edged shadow underneath the product. 
			No text, logos, or other distracting elements are allowed. The product should be captured with a high-end DSLR camera using a macro lens, set with a shallow depth of field (f/1.8). 
			The lighting is soft and even, highlighting the product's details and texture without harsh reflections. 
			The product picture should match the name ${product.name} with the product description: ${product.description} from the category ${category}.`;

        if (additionalInformation && additionalInformation.trim().length > 0) {
            prompt = `${prompt} Additional context to consider for the image styling or details: \"${additionalInformation}\".`;
        }

        let imageBase64: string = "";

        try {
            const imageResponse = await this.openAI.images.generate({
                model: "gpt-image-2.5-flare",
                prompt: prompt,
                size: "1024x1024",
                n: 1,
            });

            if (imageResponse.data?.[0]?.b64_json) {
                imageBase64 = imageResponse.data[0].b64_json;
            }
        } catch (e) {
            console.warn(e);
        }

        if (!imageBase64.length) {
            return product;
        }

        if (!fs.existsSync(imageFsPath)) {
            try {
                fs.writeFileSync(imageFsPath, imageBase64, "base64");
            } catch (err) {
                console.error(err);
            }
        }

        console.log(`Image for product ${product.name} generated successfully.`);

        product.image = {
            name: imageName,
            type: ".png",
            data: imageBase64,
        };

        return product;
    }

    createCategoryImageDir(category: string): string {
        const categoryImageDir = `${this.imageDir}/${category.replace(/[^a-zA-Z]/g, "")}`;

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
