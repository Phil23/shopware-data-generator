import { DataHydrator } from "./data-hydrator.js";

const openAiApiKey = process.env['OPENAI_API_KEY'];

const swEnvUrl = process.env['SW_ENV_URL'];
const clientId = process.env['SW_CLIENT_ID'];
const clientSecret = process.env['SW_CLIENT_SECRET'];

const category = process.env['npm_config_category'] || 'soft drinks';
const productCount = process.env['npm_config_products'] || 10;

const dataHydrator = new DataHydrator(openAiApiKey, swEnvUrl, clientId, clientSecret);

const products = await dataHydrator.generateProducts(category, productCount);
await dataHydrator.hydrateEnvWithProducts(products, category);
