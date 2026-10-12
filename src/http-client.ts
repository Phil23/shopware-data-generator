type HttpRequestOptions = {
    headers?: RequestInit["headers"];
};

type HttpResponse<T> = {
    data: T;
    status: number;
};

export class HttpClient {
    private readonly baseUrl: string;
    private readonly headers = new Headers();

    constructor(baseUrl = "") {
        this.baseUrl = baseUrl.endsWith("/") || !baseUrl ? baseUrl : `${baseUrl}/`;
    }

    setHeader(name: string, value: string) {
        this.headers.set(name, value);
    }

    async post<T = any>(
        path: string,
        body?: unknown,
        options: HttpRequestOptions = {},
    ): Promise<HttpResponse<T>> {
        const headers = new Headers(this.headers);
        new Headers(options.headers).forEach((value, name) => headers.set(name, value));
        if (!headers.has("Accept")) {
            headers.set("Accept", "application/json, text/plain, */*");
        }

        let requestBody: RequestInit["body"];
        if (body instanceof Uint8Array || typeof body === "string") {
            requestBody = body;
        } else if (body !== undefined) {
            headers.set("Content-Type", "application/json");
            requestBody = JSON.stringify(body);
        }

        const response = await fetch(new URL(path, this.baseUrl), {
            method: "POST",
            headers,
            body: requestBody,
        });

        const responseText = await response.text();
        let data: unknown = responseText;

        if (responseText) {
            try {
                data = JSON.parse(responseText);
            } catch {
                // Leave non-JSON responses as text.
            }
        }

        if (!response.ok) {
            const errorDetails =
                typeof data === "string" ? data : JSON.stringify(data) || response.statusText;
            throw new Error(`HTTP ${response.status}: ${errorDetails}`);
        }

        return { data: data as T, status: response.status };
    }
}
