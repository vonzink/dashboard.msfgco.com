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

    setAuthToken(token, maxAge) {
        localStorage.setItem("auth_token", token);
        // Set shared domain cookie — max-age defaults to 1 hour (matches Cognito access token TTL)
        var age = maxAge || 3600;
        document.cookie = "auth_token=" + encodeURIComponent(token) + "; path=/; domain=.msfgco.com; max-age=" + age + "; SameSite=Lax; Secure";
    },

    clearAuth() {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("refresh_token");
        sessionStorage.removeItem("auth_token");
        // Clear domain cookie
        document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
        // Clear path-only cookie too (legacy)
        document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    },

    /**
     * Attempt to silently refresh the access token using the stored Cognito refresh_token.
     * Returns the new access_token on success, or null on failure.
     *
     * Uses a lock (_refreshPromise) so that concurrent 401 responses
     * coalesce into a single refresh call instead of racing.
     */
    _refreshPromise: null,

    async refreshAccessToken() {
        // If a refresh is already in flight, wait for it instead of starting another
        if (this._refreshPromise) {
            return this._refreshPromise;
        }

        this._refreshPromise = this._doRefresh();
        try {
            return await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
        }
    },

    async _doRefresh() {
        var refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) return null;

        try {
            var response = await fetch("https://us-west-1s6ie2uego.auth.us-west-1.amazoncognito.com/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: "2t9edrhu5crf8vq3ivigv6jopf",
                    refresh_token: refreshToken,
                }),
            });

            if (!response.ok) {
                console.warn("Token refresh failed:", response.status);
                return null;
            }

            var tokens = await response.json();
            // Prefer ID token (has email claim for DB user lookup).
            // Cognito refresh also returns a new id_token.
            var newToken = tokens.id_token || tokens.access_token;
            if (newToken) {
                this.setAuthToken(newToken, tokens.expires_in || 3600);
                console.log("Token refreshed silently");
                return newToken;
            }
            return null;
        } catch (err) {
            console.warn("Token refresh error:", err);
            return null;
        }
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
                // Try silent token refresh (coalesced — only one refresh runs at a time)
                var newToken = await this.refreshAccessToken();
                if (newToken) {
                    // Retry the original request with the new token
                    var retryResponse = await fetch(url, {
                        ...options,
                        headers: {
                            ...(options.headers || {}),
                            Authorization: "Bearer " + newToken,
                        },
                    });
                    if (retryResponse.ok) {
                        return retryResponse.json();
                    }
                    // Retry also got non-200 — but it might be 403 (forbidden, not auth).
                    // Only clear auth if it's still 401.
                    if (retryResponse.status !== 401) {
                        var retryErr = await retryResponse.json().catch(() => ({}));
                        throw new Error(retryErr.error || retryResponse.statusText);
                    }
                }
                // Refresh failed or retry still 401 — redirect to login once
                if (!this._redirecting) {
                    this._redirecting = true;
                    console.warn("401 Unauthorized — redirecting to login");
                    this.clearAuth();
                    window.location.href = "/login.html";
                }
                throw new Error("Session expired");
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

    // ========================================
    // CURRENT USER
    // ========================================
    getMe() {
        return this.get("/me");
    },

    // ========================================
    // INVESTORS
    // ========================================
    getInvestors() {
        return this.get("/investors");
    },

    getInvestor(key) {
        return this.get(`/investors/${key}`);
    },

    createInvestor(data) {
        return this.post("/investors", data);
    },

    updateInvestor(idOrKey, data) {
        return this.put(`/investors/${idOrKey}`, data);
    },

    deleteInvestor(idOrKey) {
        return this.delete(`/investors/${idOrKey}`);
    },

    // ========================================
    // FUNDED LOANS
    // ========================================
    getFundedLoans(params = {}) {
        const qs = this.buildQuery(params);
        return this.get(`/funded-loans${qs}`);
    },

    getFundedLoansSummary(params = {}) {
        const qs = this.buildQuery(params);
        return this.get(`/funded-loans/summary${qs}`);
    },

    getFundedLoansByLO(params = {}) {
        const qs = this.buildQuery(params);
        return this.get(`/funded-loans/by-lo/summary${qs}`);
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
    // ========================================
    // CHAT + TAGS
    // ========================================
    getChatMessages(params = {}) {
        const qs = this.buildQuery(params);
        return this.get(`/chat/messages${qs}`);
    },

    sendChatMessage(message, tagIds) {
        return this.post("/chat/messages", { message, tag_ids: tagIds || [] });
    },

    updateMessageTags(messageId, tagIds) {
        return this.put(`/chat/messages/${messageId}/tags`, { tag_ids: tagIds });
    },

    deleteChatMessage(id) {
        return this.delete(`/chat/messages/${id}`);
    },

    getChatTags() {
        return this.get("/chat/tags");
    },

    createChatTag(name, color) {
        return this.post("/chat/tags", { name, color });
    },

    deleteChatTag(id) {
        return this.delete(`/chat/tags/${id}`);
    },

    // ========================================
    // MONDAY.COM INTEGRATION
    // ========================================

    /** Fetch board columns from Monday.com (admin) */
    getMondayColumns(boardId) {
        const qs = boardId ? `?board=${boardId}` : '';
        return this.get('/monday/columns' + qs);
    },

    /** List configured boards (with full details) */
    getMondayBoards() {
        return this.get('/monday/boards');
    },

    /** Add a new board */
    addMondayBoard(data) {
        return this.post('/monday/boards', data);
    },

    /** Update board config */
    updateMondayBoard(boardId, data) {
        return this.put(`/monday/boards/${boardId}`, data);
    },

    /** Remove a board */
    deleteMondayBoard(boardId) {
        return this.delete(`/monday/boards/${boardId}`);
    },

    /** Get saved column mappings (admin) */
    getMondayMappings(boardId) {
        const qs = boardId ? `?board=${boardId}` : '';
        return this.get('/monday/mappings' + qs);
    },

    /** Save column mappings (admin) — mappings: [{ mondayColumnId, mondayColumnTitle, pipelineField }] */
    saveMondayMappings(mappings, boardId) {
        return this.post('/monday/mappings', { mappings, boardId });
    },

    /** Trigger a read-only sync from Monday.com → pipeline (admin) */
    syncMonday() {
        return this.post('/monday/sync', {});
    },

    /** Get last sync status */
    getMondaySyncStatus() {
        return this.get('/monday/sync/status');
    },

    /** Get sync history (admin) */
    getMondaySyncLog() {
        return this.get('/monday/sync/log');
    },

    getMondayViewConfig() {
        return this.get('/monday/view-config');
    },

    // ========================================
    // EMPLOYEE PROFILES
    // ========================================
    getEmployeeProfile(userId) {
        return this.get(`/admin/users/${userId}/profile`);
    },

    updateEmployeeProfile(userId, data) {
        return this.put(`/admin/users/${userId}/profile`, data);
    },

    getEmployeeNotes(userId) {
        return this.get(`/admin/users/${userId}/notes`);
    },

    createEmployeeNote(userId, note) {
        return this.post(`/admin/users/${userId}/notes`, { note });
    },

    deleteEmployeeNote(userId, noteId) {
        return this.delete(`/admin/users/${userId}/notes/${noteId}`);
    },

    getEmployeeDocuments(userId) {
        return this.get(`/admin/users/${userId}/documents`);
    },

    getEmployeeDocDownloadUrl(userId, docId) {
        return this.get(`/admin/users/${userId}/documents/${docId}/download-url`);
    },
};

window.ServerAPI = ServerAPI;

