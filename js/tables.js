/* ============================================
   MSFG Dashboard - Table Manager
   Sorting, filtering, and search functionality
   ============================================ */

const TableManager = {
    // ========================================
    // INITIALIZATION
    // ========================================
    init() {
        this.initSorting();
        this.initSearch();
        this.initFilters();
        console.log('TableManager initialized');
    },

    // ========================================
    // SORTING
    // ========================================
    initSorting() {
        document.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', (e) => this.handleSort(e));
        });
    },

    handleSort(e) {
        const header = e.currentTarget;
        const table = header.closest('table');
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const columnIndex = header.cellIndex;
        const isCurrentlyAsc = header.classList.contains('sorted-asc');
        
        // Remove sorted classes from all headers in this table
        table.querySelectorAll('.sortable').forEach(h => {
            h.classList.remove('sorted', 'sorted-asc', 'sorted-desc');
        });
        
        // Add new sorted class
        header.classList.add('sorted', isCurrentlyAsc ? 'sorted-desc' : 'sorted-asc');
        
        // Sort the rows
        const sortedRows = this.sortRows(rows, columnIndex, !isCurrentlyAsc);
        
        // Append sorted rows
        sortedRows.forEach(row => tbody.appendChild(row));
    },

    sortRows(rows, columnIndex, ascending) {
        return rows.sort((a, b) => {
            let aVal = this.getCellValue(a.cells[columnIndex]);
            let bVal = this.getCellValue(b.cells[columnIndex]);
            
            // Determine type and compare
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return ascending ? aVal - bVal : bVal - aVal;
            }
            
            // String comparison
            const comparison = String(aVal).localeCompare(String(bVal));
            return ascending ? comparison : -comparison;
        });
    },

    getCellValue(cell) {
        if (!cell) return '';
        
        const text = cell.textContent.trim();
        
        // Check for currency
        if (text.startsWith('$')) {
            return Utils.parseCurrency(text);
        }
        
        // Check for date patterns (e.g., "Dec 1, 2024")
        if (text.match(/^[A-Z][a-z]{2} \d{1,2}/)) {
            return new Date(text).getTime() || 0;
        }
        
        // Check for percentage
        if (text.endsWith('%')) {
            return parseFloat(text) || 0;
        }
        
        // Check for plain number
        const num = parseFloat(text.replace(/,/g, ''));
        if (!isNaN(num)) {
            return num;
        }
        
        return text.toLowerCase();
    },

    // ========================================
    // SEARCH
    // ========================================
    initSearch() {
        // Pre-approvals search
        this.bindSearch('preApprovalSearch', 'preApprovalsTable');
        
        // Pipeline search
        this.bindSearch('pipelineSearch', 'pipelineTable');
    },

    bindSearch(inputId, tableId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        const debouncedSearch = Utils.debounce((searchTerm) => {
            this.filterTableBySearch(tableId, searchTerm);
        }, 200);
        
        input.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    },

    filterTableBySearch(tableId, searchTerm) {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        const filter = searchTerm.toLowerCase();
        const rows = table.querySelectorAll('tbody tr');
        
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
        });
        
        this.updateResultsCount(tableId);
    },

    // ========================================
    // DROPDOWN FILTERS
    // ========================================
    initFilters() {
        document.querySelectorAll('.filter-select').forEach(select => {
            select.addEventListener('change', (e) => this.handleFilterChange(e));
        });
    },

    handleFilterChange(e) {
        const select = e.target;
        const filterId = select.id;
        const value = select.value;
        
        // Determine table based on filter ID
        let tableId;
        let columnIndex;
        
        if (filterId.startsWith('preApproval')) {
            tableId = 'preApprovalsTable';
            columnIndex = this.getColumnIndexForFilter(filterId, 'preApproval');
        } else if (filterId.startsWith('pipeline')) {
            tableId = 'pipelineTable';
            columnIndex = this.getColumnIndexForFilter(filterId, 'pipeline');
        }
        
        if (tableId) {
            this.filterTableByColumn(tableId, columnIndex, value);
        }
    },

    getColumnIndexForFilter(filterId, prefix) {
        const filterMap = {
            'preApproval': {
                'preApprovalStatus': 4,
                'preApprovalType': 7,
                'preApprovalLO': 5
            },
            'pipeline': {
                'pipelineStage': 3,
                'pipelineInvestor': 6
            }
        };
        
        return filterMap[prefix]?.[filterId] ?? -1;
    },

    filterTableByColumn(tableId, columnIndex, value) {
        const table = document.getElementById(tableId);
        if (!table || columnIndex < 0) return;
        
        const rows = table.querySelectorAll('tbody tr');
        
        rows.forEach(row => {
            if (!value) {
                // Show all if no filter value
                row.style.display = '';
            } else {
                const cell = row.cells[columnIndex];
                const cellText = cell?.textContent.toLowerCase() || '';
                row.style.display = cellText.includes(value.toLowerCase()) ? '' : 'none';
            }
        });
        
        this.updateResultsCount(tableId);
    },

    // ========================================
    // UTILITY METHODS
    // ========================================
    updateResultsCount(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        const visibleRows = table.querySelectorAll('tbody tr:not([style*="display: none"])');
        const totalRows = table.querySelectorAll('tbody tr');
        
        // Could update a results count display here
        console.log(`${tableId}: Showing ${visibleRows.length} of ${totalRows.length} rows`);
    },

    clearFilters(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        // Show all rows
        table.querySelectorAll('tbody tr').forEach(row => {
            row.style.display = '';
        });
        
        // Reset select filters
        const prefix = tableId.includes('preApproval') ? 'preApproval' : 'pipeline';
        document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => {
            if (el.tagName === 'SELECT') el.value = '';
            if (el.tagName === 'INPUT') el.value = '';
        });
    },

    refreshTable(tableId) {
        // Trigger data reload for specific table
        console.log(`Refreshing table: ${tableId}`);
        // This would call the API to reload data
    }
};

// Export to global scope
window.TableManager = TableManager;
