# AI Data Hydrator
The data hydrator is a tool to create synthetic test and demo data and hydrate a Shopware environment with it. It uses OpenAI to create realistic product information and product images.

## Setup
Create an `.env` file to configure the necessary API keys.

```
OPENAI_API_KEY = <your-api-key-from-open-ai>

SW_ENV_URL = <the-url-of-your-shopware-env>
SW_CLIENT_ID = <the-client-id-from-your-env>
SW_CLIENT_SECRET = <the-secret-key-from-your-env>
```

## Usage
You can create products of a specific category / industry by simply calling the following command:

```
npm run generate --category="furniture"
```