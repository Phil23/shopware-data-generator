import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
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
    const additionalInformation = request.body["additionalInformation"] || "";

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

    let payload;
    try {
        const propertyGroupsData = await dataGenerator.generatePropertyGroups(productCategory);
        const propertyGroups = dataHydrator.createPropertyGroupsPayload(propertyGroupsData || []);
        const products = await dataGenerator.generateProducts(
            productCategory,
            productCount,
            propertyGroups,
            true,
            true,
            200,
            additionalInformation,
        );
        if (!products?.length) throw new Error("No products could be generated.");
        payload = await dataHydrator.createSavedPayload(
            propertyGroups,
            products,
            productCategory,
            salesChannelName,
        );
        const payloadDir = path.resolve("generatedPayloads");
        await fs.mkdir(payloadDir, { recursive: true });
        const slug =
            productCategory
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "demo-data";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        await fs.writeFile(
            path.join(payloadDir, `${timestamp}-${slug}.json`),
            `${JSON.stringify(payload, null, 2)}\n`,
        );
        await dataHydrator.applySavedPayload(payload);
    } catch (e) {
        console.error(e);
        response.status(500).send(e instanceof Error ? e.message : e);
        return;
    }

    response
        .status(200)
        .type("application/json")
        .send({ message: "Products generated successfully.", payloadSaved: true });
});
