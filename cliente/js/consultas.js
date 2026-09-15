const { createApp } = Vue;

const TIPO_MAPPINGS = {
    1: { pelicula: 0, fallo: 1, serie: 2 },
    2: { fallo: 0, serie: 1, pelicula: 2 },
    3: { serie: 0, pelicula: 1, fallo: 2 },
};

createApp({
    data() {
        return {
            items: [],
            selected: {},
            filterDraft: { tipo: 'todo', resueltas: [], previas: '', posteriores: '' },
            appliedFilters: { tipo: 'todo', resueltas: [], previas: '', posteriores: '' },
            sort: { column: null },
            // Refleja el atributo `data-sort-order`, compartido entre todas las columnas
            // salvo "Tipo": cada clic en una columna normal invierte esta única bandera.
            sortOrderFlag: null,
            appliedAscending: false,
            tipoSortState: 1,
            activeTipoState: 1,
        };
    },
    computed: {
        filteredItems() {
            const { tipo, resueltas, previas, posteriores } = this.appliedFilters;
            const previasDate = previas ? new Date(previas) : null;
            const posterioresDate = posteriores ? new Date(posteriores) : null;

            return this.items.filter((item) => {
                let matches = true;
                const fecha = new Date((item.Fecha || '').slice(0, 10));

                if (tipo !== 'todo' && item.Tipo !== tipo) {
                    matches = false;
                }

                if (resueltas.length !== 2) {
                    if (resueltas.includes('si') && item.Resuelto === 0) {
                        matches = false;
                    } else if (resueltas.includes('no') && item.Resuelto === 1) {
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
            const column = this.sort.column;
            if (column === null) return items;

            if (column === 2) {
                const mapping = TIPO_MAPPINGS[this.activeTipoState];
                return items.sort((a, b) => {
                    const aRank = mapping[a.Tipo] ?? 999;
                    const bRank = mapping[b.Tipo] ?? 999;
                    return aRank - bRank;
                });
            }

            const ascending = this.appliedAscending;

            if (column === 6) {
                return items.sort((a, b) => {
                    const aVal = parseInt(a.Resuelto) || 0;
                    const bVal = parseInt(b.Resuelto) || 0;
                    return ascending ? aVal - bVal : bVal - aVal;
                });
            }

            const fieldMap = { 0: 'ID', 1: 'Usuario', 3: 'Nombre', 4: 'Descripcion' };
            return items.sort((a, b) => {
                let aText, bText;
                if (column === 5) {
                    aText = (a.Fecha || '').slice(0, 10);
                    bText = (b.Fecha || '').slice(0, 10);
                } else {
                    const field = fieldMap[column];
                    aText = String(a[field] ?? '');
                    bText = String(b[field] ?? '');
                }
                if (aText < bText) return ascending ? -1 : 1;
                if (aText > bText) return ascending ? 1 : -1;
                return 0;
            });
        },
    },
    methods: {
        async loadItems() {
            try {
                const response = await fetch('/api/items');
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
                tipo: this.filterDraft.tipo,
                resueltas: [...this.filterDraft.resueltas],
                previas: this.filterDraft.previas,
                posteriores: this.filterDraft.posteriores,
            };
        },
        sortTable(columnIndex) {
            if (columnIndex === 2) {
                this.activeTipoState = this.tipoSortState;
                this.tipoSortState = this.tipoSortState >= 3 ? 1 : this.tipoSortState + 1;
                this.sort.column = 2;
                return;
            }
            const isAscending = this.sortOrderFlag === 'asc';
            this.appliedAscending = isAscending;
            this.sort.column = columnIndex;
            this.sortOrderFlag = isAscending ? 'desc' : 'asc';
        },
        headerArrow(colIndex) {
            if (colIndex !== this.sort.column) return '▼';
            return this.sortOrderFlag === 'asc' ? '▲' : '▼';
        },
        toggleRow(id, event) {
            if (event.target.type === 'checkbox') return;
            this.selected[id] = !this.selected[id];
        },
        async sendSelectedItems() {
            const selectedIds = Object.entries(this.selected)
                .filter(([, checked]) => checked)
                .map(([id]) => id);

            if (selectedIds.length === 0) {
                alert('No hay elementos seleccionados para enviar.');
                return;
            }

            const selectedItems = {};
            selectedIds.forEach((id) => {
                const item = this.items.find((i) => String(i.ID) === String(id));
                if (item) selectedItems[id] = String(item.Resuelto);
            });

            try {
                const response = await fetch('/completar-consultas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectedItems }),
                });
                this.items = await response.json();
                this.selected = {};
            } catch (error) {
                console.error('Error:', error);
            }
        },
    },
    mounted() {
        this.loadItems();
    },
}).mount('#app');
