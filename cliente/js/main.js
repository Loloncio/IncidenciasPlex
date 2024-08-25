const requestTypeSelect = document.getElementById('requestType');
const seasonField = document.getElementById('seasonField');
const descriptionLabel = document.getElementById('descriptionLabel');

requestTypeSelect.addEventListener('change', function () {
    if (this.value === 'serie') {
        seasonField.classList.remove('hidden');
        descriptionLabel.textContent = "Nombre de serie:";
    } else {
        seasonField.classList.add('hidden');
        if (this.value === 'pelicula') {
            descriptionLabel.textContent = "Nombre de película:";
        } else if (this.value === 'fallo') {
            descriptionLabel.textContent = "Describe el fallo:";
        }
    }
});