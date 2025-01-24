import express from "express";
import { DataHydrator } from "./data-hydrator.js";

const openAiApiKey = process.env['OPENAI_API_KEY'];
const port = process.env['SERVER_PORT'] || 3000;

const dataHydrator = new DataHydrator(openAiApiKey);
const app = express();

app.use(express.json());

app.listen(port, () => {
    console.log(`Server started on port ${port}.`);
});

app.post('/generate', async (request, response) => {
    console.log(request.body);

    const envPath = request.body['envPath'];
    const productCategory = request.body['category'] || 'soft drinks';
    const productCount = request.body['productCount'] || 10;

    if (!envPath) {
        response.status(500).send('Missing parameter "envPath".');
        return;
    }

    const shopwareUser = request.body['shopwareUser'];
    const shopwarePassword = request.body['shopwarePassword'];

    if (!shopwareUser || !shopwarePassword) {
        response.status(500).send('Missing shopware login information.');
        return;
    }

    const authSuccess = await dataHydrator.authenticateWithUserCredentials(envPath, shopwareUser, shopwarePassword);

    if (!authSuccess) {
        response.status(401).send('Authentication with the Shopware environment failed.');
        return;
    }

    let products = [];

    try {
        products = await dataHydrator.generateProducts(productCategory, productCount);
    } catch (e) {
        response.status(500).send(e);
        return;
    }

    if (!products.length) {
        response.status(500).send('No products could be generated.');
        return;
    }

    try {
        const generateResponse = await dataHydrator.hydrateEnvWithProducts(products, productCategory);

        console.log('Generate Response');
    } catch (e) {
        response.status(500).send(e);
        return;
    }

    response.status(200).type('application/json').send({ message: 'Products generated successfully.' });
});