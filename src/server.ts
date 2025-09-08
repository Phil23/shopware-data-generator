import express from "express";
import { DataHydrator } from "./data-hydrator.js";
import { DataGenerator } from "./data-generator.js";

const openAiApiKey = process.env["OPENAI_API_KEY"];
const port = process.env["SERVER_PORT"] || 3000;

if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing!");
}

const dataHydrator = new DataHydrator();
const dataGenerator = new DataGenerator(openAiApiKey);
const app = express();

app.use(express.json());

app.listen(port, () => {
    console.log(`Server started on port ${port}.`);
});

app.post("/generate", async (request, response) => {
    const envPath = request.body["envPath"];
    const productCategory = request.body["category"] || "soft drinks";
    const productCount = request.body["productCount"] || 10;
    const salesChannelName = request.body["salesChannel"] || "Storefront";

    if (!envPath) {
        response.status(500).send('Missing parameter "envPath".');
        return;
    }

    const shopwareUser = request.body["shopwareUser"];
    const shopwarePassword = request.body["shopwarePassword"];

    if (!shopwareUser || !shopwarePassword) {
        response.status(500).send("Missing shopware login information.");
        return;
    }

    const authSuccess = await dataHydrator.authenticateWithUserCredentials(
        envPath,
        shopwareUser,
        shopwarePassword,
    );

    if (!authSuccess) {
        response.status(401).send("Authentication with the Shopware environment failed.");
        return;
    }

    let propertyGroups = null;
    let products = [];

    try {
        const propertyGroupsData = await dataGenerator.generatePropertyGroups(productCategory);
        propertyGroups = await dataHydrator.hydrateEnvWithPropertyGroups(propertyGroupsData);
    } catch (e) {
        console.error(e);
        response.status(500).send(e);
        return;
    }

    try {
        products = await dataGenerator.generateProducts(
            productCategory,
            productCount,
            propertyGroups,
            true,
            true,
        );
    } catch (e) {
        console.error(e);
        response.status(500).send(e);
        return;
    }

    if (!products.length) {
        response.status(500).send("No products could be generated.");
        return;
    }

    try {
        await dataHydrator.hydrateEnvWithProducts(products, productCategory, salesChannelName);
    } catch (e) {
        console.error(e);
        response.status(500).send(e);
        return;
    }

    response
        .status(200)
        .type("application/json")
        .send({ message: "Products generated successfully." });
});
