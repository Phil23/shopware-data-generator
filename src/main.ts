import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseArgs } from "node:util";
import { DataHydrator, type SavedPayload } from "./data-hydrator.js";
import {
    DataGenerator,
    TEXT_GENERATION_MODELS,
    type TextGenerationModel,
} from "./data-generator.js";

function isTextGenerationModel(model: string): model is TextGenerationModel {
    return TEXT_GENERATION_MODELS.includes(model as TextGenerationModel);
}

const { positionals, values: options } = parseArgs({
    args: process.argv.slice(2),
    options: {
        category: { type: "string" },
        products: { type: "string" },
        "sales-channel": { type: "string" },
        model: { type: "string" },
    },
    allowPositionals: true,
});

const command = positionals[0] || "generate";
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

async function promptGenerationOptions(defaults: {
    category: string;
    productCount: number;
    salesChannelName: string;
    model: TextGenerationModel;
}) {
    if (!input.isTTY) {
        return defaults;
    }

    const rl = createInterface({ input, output });
    try {
        const categoryAnswer = await rl.question(`Category [${defaults.category}]: `);
        let productCount = defaults.productCount;
        while (true) {
            const productCountAnswer = await rl.question(
                `Number of products [${defaults.productCount}]: `,
            );
            productCount = productCountAnswer.trim()
                ? Number(productCountAnswer.trim())
                : defaults.productCount;
            if (Number.isInteger(productCount) && productCount > 0) {
                break;
            }
            console.log("Enter a positive whole number.");
        }
        const salesChannelAnswer = await rl.question(
            `Sales channel [${defaults.salesChannelName}]: `,
        );
        let model: TextGenerationModel = defaults.model;
        while (true) {
            const modelAnswer = await rl.question(
                `Text model [${defaults.model}] (${TEXT_GENERATION_MODELS.join(" / ")}): `,
            );
            const selectedModel = modelAnswer.trim() || defaults.model;
            if (isTextGenerationModel(selectedModel)) {
                model = selectedModel;
                break;
            }
            console.log(`Choose one of: ${TEXT_GENERATION_MODELS.join(", ")}.`);
        }

        return {
            category: categoryAnswer.trim() || defaults.category,
            productCount,
            salesChannelName: salesChannelAnswer.trim() || defaults.salesChannelName,
            model,
        };
    } finally {
        rl.close();
    }
}

async function generate() {
    const openAiApiKey = process.env["OPENAI_API_KEY"];
    if (!openAiApiKey) throw new Error("OPENAI_API_KEY is missing!");

    const category = options.category || "Soft Drinks";
    const productCount = options.products ? Number(options.products) : 10;
    if (!Number.isInteger(productCount) || productCount < 1) {
        throw new Error("The --products option must be a positive integer.");
    }
    const salesChannelName = options["sales-channel"] || "Storefront";
    const model = options.model || "gpt-6-luna";
    if (!isTextGenerationModel(model)) {
        throw new Error(`The --model option must be one of: ${TEXT_GENERATION_MODELS.join(", ")}.`);
    }
    const generationOptions = await promptGenerationOptions({
        category,
        productCount,
        salesChannelName,
        model,
    });
    const dataGenerator = new DataGenerator(
        openAiApiKey,
        "./generatedImages",
        generationOptions.model,
    );

    await authenticate();
    const propertyGroupsData = await dataGenerator.generatePropertyGroups(
        generationOptions.category,
    );
    const propertyGroups = dataHydrator.createPropertyGroupsPayload(propertyGroupsData || []);
    const products = await dataGenerator.generateProducts(
        generationOptions.category,
        generationOptions.productCount,
        propertyGroups,
    );
    if (!products?.length) throw new Error("No products could be generated.");

    const payload = await dataHydrator.createSavedPayload(
        propertyGroups,
        products,
        generationOptions.category,
        generationOptions.salesChannelName,
    );
    await fs.mkdir(payloadDir, { recursive: true });
    const slug =
        generationOptions.category
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
