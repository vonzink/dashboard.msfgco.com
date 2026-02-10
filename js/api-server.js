/* ============================================
   MSFG Dashboard - Server API Integration
   ============================================ */

const ServerAPI = {
    // ========================================
    // AUTHENTICATION
    // ========================================
    getAuthToken() {
        // Cognito token: localStorage → shared domain cookie → sessionStorage
        const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
        return (
            localStorage.getItem("auth_token") ||
            (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null) ||
            sessionStorage.getItem("auth_token")
        );
    },

    setAuthToken(token) {
        localStorage.setItem("auth_token", token);
        // Also set shared domain cookie for cross-subdomain auth
        document.cookie = "auth_token=" + encodeURIComponent(token) + "; path=/; domain=.msfgco.com; max-age=" + (60 * 60 * 24) + "; SameSite=Lax; Secure";
    },

    clearAuth() {
        localStorage.removeItem("auth_token");
        sessionStorage.removeItem("auth_token");
        // Clear domain cookie
        document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
        // Clear path-only cookie too (legacy)
        document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    },

    // ========================================
    // REQUEST CORE
    // ========================================
    async request(endpoint, options = {}) {
        const url = `${CONFIG.api.baseUrl}${endpoint}`;
        const token = this.getAuthToken();

        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            CONFIG.api.timeout
        );

        const headers = {
            ...(options.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.status === 401) {
                console.warn("401 Unauthorized — clearing auth and redirecting to login");
                this.clearAuth();
                window.location.href = "/login.html";
                throw new Error("Unauthorized");
            }

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || response.statusText);
            }

            return response.json();
        } catch (err) {
            console.error(`API Error (${endpoint})`, err);
            throw err;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: "GET" });
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    },

    put(endpoint, data) {
        return this.request(endpoint, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    },

    // ========================================
    // FILE UPLOAD
    // ========================================
    async uploadFile(endpoint, file, extra = {}) {
        const token = this.getAuthToken();
        const form = new FormData();

        form.append("file", file);
        Object.entries(extra).forEach(([k, v]) => form.append(k, v));

        const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
        });

        if (!response.ok) {
            throw new Error("Upload failed");
        }

        return response.json();
    },

    // ========================================
    // API ENDPOINTS
    // ========================================
    buildQuery(params = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            searchParams.set(key, value);
        });

        const query = searchParams.toString();
        return query ? `?${query}` : "";
    },

    getAnnouncements() {
        return this.get("/announcements");
    },

    createAnnouncement(data) {
        return this.post("/announcements", data);
    },

    deleteAnnouncement(id) {
        return this.delete(`/announcements/${id}`);
    },

    createNotification(userId, reminderDate, reminderTime, note) {
        return this.post("/notifications", {
            user_id: userId,
            reminder_date: reminderDate,
            reminder_time: reminderTime,
            note,
        });
    },

    getGoals(userId, periodType, periodValue) {
        if (typeof userId === "string" && userId.startsWith("?")) {
            return this.get(`/goals${userId}`);
        }

        const query = this.buildQuery({
            user_id: userId,
            period_type: periodType,
            period_value: periodValue,
        });
        return this.get(`/goals${query}`);
    },

    updateGoals(data) {
        return this.put("/goals", data);
    },

    getPipeline(userId) {
        const query = this.buildQuery({ user_id: userId });
        return this.get(`/pipeline${query}`);
    },

    updateInvestor(idOrKey, data) {
        return this.put(`/investors/${idOrKey}`, data);
    },

    getUploadUrl(fileName, fileType, fileSize) {
        return this.post("/files/upload-url", { fileName, fileType, fileSize });
    },

    async uploadToS3(uploadUrl, file) {
        const response = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
        });

        if (!response.ok) {
            throw new Error("Upload failed");
        }
        return true;
    },
};

window.ServerAPI = ServerAPI;

