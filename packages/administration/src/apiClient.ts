import axios from "axios";

export const apiClient = axios.create({
    baseURL: "http://localhost:8787/client-api/",
    headers: {
        "Content-Type": "application/json",
    },
});
