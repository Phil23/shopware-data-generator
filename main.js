import { DataHydrator } from './data-hydrator.js';
import { DataGenerator } from './data-generator.js';

const openAiApiKey = process.env['OPENAI_API_KEY'];

const swEnvUrl = process.env['SW_ENV_URL'];
const clientId = process.env['SW_CLIENT_ID'];
const clientSecret = process.env['SW_CLIENT_SECRET'];

const category = process.env['npm_config_category'] || 'soft drinks';
const productCount = process.env['npm_config_products'] || 10;

const dataHydrator = new DataHydrator();
const dataGenerator = new DataGenerator(openAiApiKey)

await dataHydrator.authenticateWithClientCredentials(swEnvUrl, clientId, clientSecret)

// const propertyGroups = await dataGenerator.generatePropertyGroups(category);
// await dataHydrator.hydrateEnvWithPropertyGroups(propertyGroups);

const products = await dataGenerator.generateProducts(category, true, true, productCount);
await dataHydrator.hydrateEnvWithProducts(products, category);
