const { createApp } = Vue;

createApp({
    data() {
        return {
            items: [],
            loading: true,
        };
    },
    methods: {
        async loadItems() {
            this.loading = true;
            try {
                const response = await fetch('/api/mis-solicitudes');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                this.items = await response.json();
            } catch (error) {
                console.error('There was a problem with the fetch operation:', error);
            } finally {
                this.loading = false;
            }
        },
    },
    mounted() {
        this.loadItems();
    },
}).mount('#app');
