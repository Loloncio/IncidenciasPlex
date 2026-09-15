const { createApp } = Vue;

createApp({
    data() {
        return {
            name: '',
            requestType: 'pelicula',
            description: '',
            message: '',
            messageColor: '',
            messageTimeoutId: null,
            submitting: false,
        };
    },
    computed: {
        descriptionLabel() {
            return this.requestType === 'pelicula' ? 'Nombre de película:' : 'Describe el fallo:';
        },
    },
    methods: {
        async submitForm() {
            this.submitting = true;
            try {
                const response = await fetch('/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: this.name,
                        requestType: this.requestType,
                        description: this.description,
                    }),
                });
                const result = await response.json();
                if (response.ok) {
                    this.showMessage('Incidencia guardada exitosamente', 'green');
                    this.name = '';
                    this.requestType = 'pelicula';
                    this.description = '';
                } else {
                    this.showMessage(result.error || 'Error al guardar la incidencia', 'red');
                }
            } catch (error) {
                this.showMessage('Error en la conexión al servidor', 'red');
            } finally {
                this.submitting = false;
            }
        },
        showMessage(message, color) {
            this.message = message;
            this.messageColor = color;
            clearTimeout(this.messageTimeoutId);
            this.messageTimeoutId = setTimeout(() => {
                this.message = '';
            }, 5000);
        },
    },
}).mount('#app');
