# AI Data Generator

The data generator is a tool to create synthetic demo data with the help of AI and hydrate a Shopware environment with it. It uses OpenAI to create product information, product images, reviews, and property groups. You can provide a category name for which type of industry you want to create products. The generator will create a new category within your Shopware instance with the generated products. The products are also assigned to the main category of your instance and assigned to the standard sales channel. If you generate more than once with the same category, the products are automatically added to the existing category.

## Setup

Create an `.env` file to configure the necessary API keys.

```
OPENAI_API_KEY = <your-api-key-from-open-ai>
```

Install the dependencies and run the build process.

```
npm install
``` 

```
npm run build
```

## Usage via CLI

You can run the generator via the CLI. Make sure to set up your environment information first via `.env` variables.

```
SW_ENV_URL = <the-url-of-your-shopware-env>
SW_CLIENT_ID = <the-client-id-from-your-env>
SW_CLIENT_SECRET = <the-secret-key-from-your-env>
```

If you don't provide these information, the generator will automatically use a fallback to a standard dev environment setting under `http://localhost:8000` and the standard development credentials.

You can then generate products simply calling the following command, including the type of products you want to generate with the `category` parameter.

```
npm run generate --category="furniture"
```

## Usage via Server

The data generator can be used as a service to hydrate different environments via server request. To run the server you can call the following command:

```
npm run server
```

By default, the server will spawn on the port `3000`. You can configure the port with the env variable `SERVER_PORT`.

For generating data via the server you can fire a `post` request to its only route `/generate`. The following request parameters should be sent via `json` body.

```JSON
{
    "envPath": "http://localhost:8000",
    "shopwareUser": "admin",
    "shopwarePassword": "shopware",
    "category": "photography",
    "productCount": 10
}
```

You can specify the environment that should be hydrated including the authentication credentials. In addition, you can specify the category and the number of products that should be generated. The number of products is optional. It is recommended to not generate more than 10 products per request as the creation of the images can take some time. You can split it into several requests to hydrate the same category multiple times.
