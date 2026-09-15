const { createApp } = Vue;

createApp({
    data() {
        return {
            items: [],
            filterDraft: { animadas: [], previas: '', posteriores: '' },
            appliedFilters: { animadas: [], previas: '', posteriores: '' },
            sortStates: {},
            activeColumn: null,
            activeOrder: 'asc',
        };
    },
    computed: {
        filteredItems() {
            const { animadas, previas, posteriores } = this.appliedFilters;
            const previasDate = previas ? new Date(previas) : null;
            const posterioresDate = posteriores ? new Date(posteriores) : null;

            return this.items.filter((item) => {
                let matches = true;
                const fecha = new Date((item.Fecha || '').slice(0, 10));

                if (animadas.length !== 2) {
                    if (animadas.includes('si') && item.Animation === 0) {
                        matches = false;
                    } else if (animadas.includes('no') && item.Animation === 1) {
                        matches = false;
                    }
                }

                if (previasDate && fecha > previasDate) matches = false;
                if (posterioresDate && fecha < posterioresDate) matches = false;

                return matches;
            });
        },
        sortedItems() {
            const items = [...this.filteredItems];
            if (this.activeColumn === null) return items;

            const ascending = this.activeOrder === 'asc';
            const isDateColumn = this.activeColumn === 3;
            const fieldMap = { 0: 'OriginalName', 1: 'NewName' };

            return items.sort((a, b) => {
                if (isDateColumn) {
                    const aDate = new Date(a.Fecha);
                    const bDate = new Date(b.Fecha);
                    return ascending ? aDate - bDate : bDate - aDate;
                }

                let aText, bText;
                if (this.activeColumn === 2) {
                    aText = parseInt(a.Animation) === 0 ? 'No' : 'Si';
                    bText = parseInt(b.Animation) === 0 ? 'No' : 'Si';
                } else {
                    const field = fieldMap[this.activeColumn];
                    aText = String(a[field] ?? '');
                    bText = String(b[field] ?? '');
                }

                return ascending
                    ? aText.localeCompare(bText, 'es', { sensitivity: 'base' })
                    : bText.localeCompare(aText, 'es', { sensitivity: 'base' });
            });
        },
    },
    methods: {
        async loadItems() {
            try {
                const response = await fetch('/api/registro');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                this.items = await response.json();
            } catch (error) {
                console.error('There was a problem with the fetch operation:', error);
            }
        },
        applyFilters() {
            this.appliedFilters = {
                animadas: [...this.filterDraft.animadas],
                previas: this.filterDraft.previas,
                posteriores: this.filterDraft.posteriores,
            };
        },
        sortTable(columnIndex) {
            const currentOrder = this.sortStates[columnIndex] || 'asc';
            const nextOrder = currentOrder === 'asc' ? 'desc' : 'asc';
            this.activeColumn = columnIndex;
            this.activeOrder = currentOrder;
            this.sortStates = { ...this.sortStates, [columnIndex]: nextOrder };
        },
        headerClass(columnIndex) {
            if (columnIndex !== this.activeColumn) return '';
            return this.activeOrder === 'asc' ? 'sort-asc' : 'sort-desc';
        },
        formatDate(fecha) {
            const date = new Date(fecha);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        },
    },
    mounted() {
        this.loadItems();
    },
}).mount('#app');
