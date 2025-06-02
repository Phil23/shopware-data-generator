<template>
    <div class="sw-data-generator">
        <mt-card title="Generate Demo Data" :isLoading="false" :large="false">
            <mt-text
                >With this tool you can generate demo data for products, including reviews and
                property groups based on a provided business category. The tool will create a new
                category under your main category with the same name. All products will be
                automatically assigned to this category. If you want to generate more products for
                the same category, the products will be added to the existing category.</mt-text
            >
            <mt-text-field
                class="category-field"
                v-model="categoryName"
                label="Business Category"
                placeholder="e.g. Soft Drinks, Furniture, Photography, etc."
            />
            <mt-number-field
                v-model="productCount"
                label="Number of Products"
                placeholder="e.g. 10"
                helpText="The number of products to generate. It is recommended to do batches of 10 or less, especially when generating images."
                bordered
            />
            <mt-switch
                v-model="createImages"
                label="Generate Images"
                helpText="If active, one image will be generated for each product, fitting the product name."
                bordered
            />
            <mt-switch
                v-model="createReviews"
                label="Generate Reviews"
                helpText="If active, five fake reviews will be generated for each product."
                bordered
            />
            <mt-switch
                v-model="createProperties"
                label="Generate Properties"
                helpText="If active, two property groups with different options fitting the business category will be generated and options will be assigned randomly to the products."
                bordered
            />
            <mt-button
                variant="primary"
                size="large"
                class="generate-button"
                :isLoading="loading"
                @click="generateData"
                >Generate</mt-button
            >
        </mt-card>
    </div>
</template>

<script setup lang="ts">
import {
    MtCard,
    MtText,
    MtTextField,
    MtNumberField,
    MtSwitch,
    MtButton,
} from "@shopware-ag/meteor-component-library";
import { ref } from "vue";
import { apiClient } from "./apiClient";

const categoryName = ref("");
const productCount = ref(10);
const createImages = ref(true);
const createReviews = ref(true);
const createProperties = ref(true);
const loading = ref(false);

const generateData = async () => {
    loading.value = true;

    const response = await apiClient.post("generate", {
        category: categoryName.value,
        productCount: productCount.value,
        createImages: createImages.value,
        createReviews: createReviews.value,
        createProperties: createProperties.value,
    });

    loading.value = false;

    if (response.status === 200) {
        console.log("response", response);
    } else {
        console.error("response", response);
    }
};
</script>

<style scoped>
.sw-data-generator {
    min-height: 500px;
    padding: 40px;
}

.category-field {
    margin-top: 40px;
}
</style>
