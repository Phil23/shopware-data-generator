import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { DataGenerator } from "./data-generator.js";
import { configureAppServer } from "@shopware-ag/app-server-sdk/integration/hono";
import { BetterSqlite3Repository } from "@shopware-ag/app-server-sdk/integration/better-sqlite3";
import { createNotificationResponse } from "@shopware-ag/app-server-sdk/helper/app-actions";
import {
    getCurrencyId,
    getStandardTaxId,
    getStandardSalesChannel,
    createProductCategory,
    createPropertyGroups,
    createProducts,
} from "./shopware-helper.js";
import path from "path";
import { fileURLToPath } from "url";
import {
    HttpClient,
    AppServer,
    type ShopInterface,
    Context,
    SimpleShop,
} from "@shopware-ag/app-server-sdk";
import { log } from "console";

declare module "hono" {
    interface ContextVariableMap {
        app: AppServer;
        shop: ShopInterface;
        context: Context;
    }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env["NODE_ENV"] === "dev";

const appName = process.env["APP_NAME"] || "DemoDataGenerator";
const appSecret = process.env["APP_SECRET"] || "DemoDataGenerator";

const serverPort = parseInt(process.env["SERVER_PORT"] || "8787");

const openAiApiKey = process.env["OPENAI_API_KEY"];

if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing!");
}

const app = new Hono();
const dataGenerator = new DataGenerator(openAiApiKey);

if (!isDev) app.use(logger());

configureAppServer(app, {
    appName,
    appSecret,
    shopRepository: new BetterSqlite3Repository("shop.db"),
    appIframeEnable: true,
    appIframeRedirects: {
        "/app/client": "/client",
    },
});

app.use("/client/*", async (c, next) => {
    return serveStatic({ path: c.req.path })(c, next);
});

app.post("/app/test", async (c) => {
    const shop = c.get("shop");
    console.log(shop);

    return createNotificationResponse("success", "Hello World");
});

app.post("/client-api/generate", async (c) => {
    const shop = c.get("shop");
    const httpClient = new HttpClient(shop);
    const body = await c.req.json();
    const productCategory = body.category || "soft drinks";
    const productCount = parseInt(body.productCount || "10");
    const createImages = body.createImages || false;
    const createReviews = body.createReviews || false;
    const createProperties = body.createProperties || false;

    // Retrieve the standard sales channel of the shop.
    const salesChannel = await getStandardSalesChannel(httpClient);

    // Create the product category if it doesn't exist.
    const category = (await createProductCategory(
        httpClient,
        productCategory,
        salesChannel,
    )) as Record<string, any>;

    let propertyGroups = null;

    if (createProperties) {
        // Generate demo data for the property groups via OpenAI.
        const propertyGroupsData = await dataGenerator.generatePropertyGroups(productCategory);

        // Create the property groups in the shopware instance.
        propertyGroups = await createPropertyGroups(httpClient, propertyGroupsData);
    }

    // Generate demo data for the products via OpenAI.
    const products = await dataGenerator.generateProducts(
        productCategory,
        productCount,
        propertyGroups,
        createImages,
        createReviews,
    );

    // Create the products in the shopware instance.
    const productsResponse = await createProducts(httpClient, products, salesChannel, category);

    console.log("Products Response", productsResponse);

    return createNotificationResponse("success", "Data generated successfully.");
});

serve({
    fetch: app.fetch,
    port: serverPort,
});

console.log(`Server is running on port ${serverPort}`);
