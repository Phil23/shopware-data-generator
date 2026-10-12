import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DataHydrator, type SavedPayload } from "./data-hydrator.js";
import { DataGenerator } from "./data-generator.js";

const command = process.argv[2] || "generate";
const payloadDir = path.resolve("generatedPayloads");
const swEnvUrl = process.env["SW_ENV_URL"] || "http://localhost:8000";
const clientId = process.env["SW_CLIENT_ID"];
const clientSecret = process.env["SW_CLIENT_SECRET"];

const dataHydrator = new DataHydrator();

async function authenticate() {
    const authenticated = await dataHydrator.authenticateWithClientCredentials(
        swEnvUrl,
        clientId,
        clientSecret,
    );
    if (!authenticated) throw new Error(`Authentication with ${swEnvUrl} failed.`);
}

async function applyWizard() {
    const files = (await fs.readdir(payloadDir).catch(() => []))
        .filter((file) => file.endsWith(".json"))
        .sort()
        .reverse();
    if (files.length === 0) {
        console.log(`No saved payloads found in ${payloadDir}. Run "npm run generate" first.`);
        return;
    }

    const rl = createInterface({ input, output });
    try {
        console.log("Saved demo data payloads:");
        files.forEach((file, index) => console.log(`  ${index + 1}) ${file}`));
        const answer = await rl.question(`Select a payload (1-${files.length}): `);
        const selection = Number.parseInt(answer, 10);
        if (!Number.isInteger(selection) || selection < 1 || selection > files.length) {
            throw new Error("Invalid payload selection.");
        }
        const selectedPath = path.join(payloadDir, files[selection - 1]!);
        const payload = JSON.parse(await fs.readFile(selectedPath, "utf8")) as SavedPayload;
        console.log(`Applying ${files[selection - 1]} to ${swEnvUrl} ...`);
        await authenticate();
        await dataHydrator.applySavedPayload(payload);
        console.log("Payload applied successfully.");
    } finally {
        rl.close();
    }
}

async function generate() {
    const openAiApiKey = process.env["OPENAI_API_KEY"];
    if (!openAiApiKey) throw new Error("OPENAI_API_KEY is missing!");

    const category = process.env["npm_config_category"] || "soft drinks";
    const productCount = Number.parseInt(process.env["npm_config_products"] || "10", 10);
    const salesChannelName = process.env["npm_config_sales_channel"] || "Storefront";
    const dataGenerator = new DataGenerator(openAiApiKey);

    await authenticate();
    const propertyGroupsData = await dataGenerator.generatePropertyGroups(category);
    const propertyGroups = dataHydrator.createPropertyGroupsPayload(propertyGroupsData || []);
    const products = await dataGenerator.generateProducts(category, productCount, propertyGroups);
    if (!products?.length) throw new Error("No products could be generated.");

    const payload = await dataHydrator.createSavedPayload(
        propertyGroups,
        products,
        category,
        salesChannelName,
    );
    await fs.mkdir(payloadDir, { recursive: true });
    const slug =
        category
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "demo-data";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payloadPath = path.join(payloadDir, `${timestamp}-${slug}.json`);
    await fs.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Saved replay payload to ${payloadPath}`);
    await dataHydrator.applySavedPayload(payload);
}

if (command === "apply") {
    await applyWizard();
} else if (command === "generate") {
    await generate();
} else {
    throw new Error(`Unknown command "${command}". Use "generate" or "apply".`);
}
