import { DataHydrator } from "./data-hydrator.js";
import { DataGenerator } from "./data-generator.js";

const openAiApiKey = process.env["OPENAI_API_KEY"];

const swEnvUrl = process.env["SW_ENV_URL"];
const clientId = process.env["SW_CLIENT_ID"];
const clientSecret = process.env["SW_CLIENT_SECRET"];

const category = process.env["npm_config_category"] || "soft drinks";
const productCount = parseInt(process.env["npm_config_products"] || "10", 10);

if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing!");
}

if (!swEnvUrl) {
    throw new Error("SW_ENV_URL is missing!");
}

const dataHydrator = new DataHydrator();
const dataGenerator = new DataGenerator(openAiApiKey);

await dataHydrator.authenticateWithClientCredentials(swEnvUrl, clientId, clientSecret);

const propertyGroupsData = await dataGenerator.generatePropertyGroups(category);
const propertyGroups = await dataHydrator.hydrateEnvWithPropertyGroups(propertyGroupsData);

const products = await dataGenerator.generateProducts(category, productCount, propertyGroups);
await dataHydrator.hydrateEnvWithProducts(products, category);
