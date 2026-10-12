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

Run the generator to answer an interactive wizard. Press Enter to accept each default:

```
npm run generate
```

You can also pass options after `--` to use them as the wizard defaults:

```
npm run generate -- --category "furniture" --products 10 --sales-channel "Storefront" --model "gpt-6-luna"
```

All options are optional. `--category` defaults to `soft drinks`, `--products` defaults to `10`, `--sales-channel` defaults to `Storefront`, and `--model` defaults to `gpt-6-luna`. Choose `gpt-6-luna` or `gpt-6.1-sol` for text generation.

When run without an interactive terminal, the generator uses the supplied options and defaults without prompting.

Each generation saves the Shopware sync payload as a JSON file in `generatedPayloads/` before applying it. Product images remain in `generatedImages/`; the saved payload references those files, so keep the payload and image directory together when moving replay data to another machine.

To apply a saved payload again without calling OpenAI, run:

```
npm run apply
```

The command displays the saved payloads and prompts for a selection. It uses the `SW_ENV_URL`, `SW_CLIENT_ID`, and `SW_CLIENT_SECRET` values from `.env` (or the development credential fallback described above). Applying the same payload again upserts the same entity IDs.

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
    "productCount": 10,
    "salesChannel": "Storefront", // optional
    "additionalInformation": "Optional additional context that is incorporated into the description and image" // optional
}
```

You can specify the environment that should be hydrated including the authentication credentials. In addition, you can specify the category and the number of products that should be generated. The number of products is optional. It is recommended to not generate more than 10 products per request as the creation of the images can take some time. You can split it into several requests to hydrate the same category multiple times.

Optional fields:

- `salesChannel`: Name of the sales channel to assign visibility (default: `Storefront`).
- `additionalInformation`: Additional free-text context that will be incorporated into both the product description prompt and the image generation prompt.
