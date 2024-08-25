
const colorMap = {
    'rgb(255, 0, 0)': '0',
    'rgb(0, 128, 0)': '1',
};

let tableItems = [];

// Selecciona el botón de alternar y la barra lateral
const toggleButton = document.querySelector('.toggle-sidebar');
const sidebar = document.querySelector('.sidebar');
const content = document.querySelector('.content');

// Select the table body and send button
const tableBody = document.querySelector('#dynamic-table tbody');
const sendButton = document.querySelector('#send-selected');
const filterForm = document.querySelector('#filter-form');

// Define the list of items (or data) to be added as rows
function getDBContents() {
    fetch('/api/items')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // Assuming `tableItems` is the variable that will hold your data
            tableItems = data;
            // Call the function to create table rows with the data
            createTableRows(tableItems);
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });


}

// Function to create and add table rows dynamically
function createTableRows(contents) {
    const tbody = document.querySelector('#dynamic-table tbody'); // Selecciona el <tbody> de la tabla
    tbody.innerHTML = '';

    contents.forEach((item) => {
        // Create a new row
        const row = document.createElement('tr');
        row.className = 'table-row';

        // Create cells for each property
        const properties = [item.ID,item.Usuario, item.Tipo, item.Descripcion, item.Temporadas, item.Fecha.slice(0, 10), item.Resuelto];
        cont = 1;
        properties.forEach(property => {
            const cell = document.createElement('td');
            cell.className = "col" + cont;
            if (cont === 7) {
                if (property === 1) {
                    var circle = document.createElement("div");
                    circle.style.width = "20px"
                    circle.style.height = "20px"
                    circle.style.backgroundColor = "green"
                    circle.style.borderRadius = "50%"
                    circle.style.margin = "auto"
                    cell.appendChild(circle)
                } else {
                    var circle = document.createElement("div");
                    circle.style.width = "20px"
                    circle.style.height = "20px"
                    circle.style.backgroundColor = "red"
                    circle.style.borderRadius = "50%"
                    circle.style.margin = "auto"
                    cell.appendChild(circle)
                }
            } else {
                cell.textContent = property
            }
            row.appendChild(cell);
            cont++;
        });

        // Create the last cell with a checkbox
        const checkboxCell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.id; // Set the value of the checkbox to item id
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);

        // Handle row click to toggle checkbox
        row.addEventListener('click', (event) => {
            if (event.target.type !== 'checkbox') {
                checkbox.checked = !checkbox.checked;
            }
        });

        // Append the row to the table body
        tableBody.appendChild(row);
    });
}

// Function to collect and send selected items
function sendSelectedItems() {
    const selectedItems = {};
    const checkboxes = document.querySelectorAll('#dynamic-table input[type="checkbox"]:checked');

    checkboxes.forEach(checkbox => {
        const row = checkbox.closest('tr'); // Find the closest row <tr> for the checkbox
        const firstColumnValue = row.querySelector('td:nth-child(1)').textContent.trim(); // Get the value of the first <td>
        const seventhColumnDiv = row.querySelector('td:nth-child(7) div'); // Get the <div> in the seventh <td>
        const divColor = window.getComputedStyle(seventhColumnDiv).backgroundColor;
        const color = colorMap[divColor];
        // Create a dictionary entry with the first column as the key and the seventh column as the value
        selectedItems[firstColumnValue] = color;
    });

    if (Object.keys(selectedItems).length > 0) {
        fetch('/completar-consultas', { // Replace with your server URL
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ selectedItems })
        })
            .then(response => response.json())
            .then(data => {
                tableItems = data
                createTableRows(tableItems);
            })
            .catch(error => {
                console.error('Error:', error);
            });
    } else {
        alert('No hay elementos seleccionados para enviar.');
    }
}

// Handle form submission to prevent page reload
filterForm.addEventListener('submit', function(event) {
    event.preventDefault(); // Prevents the form from submitting the traditional way

    // Create a FormData object from the form
    const formData = new FormData(this);

    // Convert FormData to a regular object
    tipo = formData.get("tipo");
    resuelta = formData.getAll("resueltas");
    console.log(resuelta)
    previas = formData.get("previas");
    posteriores = formData.get("posteriores");
    const filteredItems = filterTableItems(tableItems, tipo, resuelta, previas, posteriores);
    createTableRows(filteredItems)

});

/**
 * Filters tableItems based on the provided form data.
 * @param {Array} tableItems - The array of items to filter.
 * @param {string} tipo - The selected type from the form.
 * @param {Array} resuelta - The selected resolved statuses from the form.
 * @param {string} previas - The date to filter items before.
 * @param {string} posteriores - The date to filter items after.
 * @returns {Array} - The filtered array of items.
 */
function filterTableItems(tableItems, tipo, resuelta, previas, posteriores) {
    // Convert dates from strings to Date objects for comparison
    const previasDate = previas ? new Date(previas) : null;
    const posterioresDate = posteriores ? new Date(posteriores) : null;
    
    return tableItems.filter(item => {
        let matches = true;
        let fecha = new Date(item.Fecha.slice(0, 10));
        // Check tipo
        if(tipo!="todo"){
            if (tipo && item.Tipo !== tipo) {
                matches = false;
            }
        }

        // Check resuelta (resolved status)
        if(resuelta.length!=2){
            if (resuelta.includes("si") && item.Resuelto === 0) {
                matches = false;
            } else if (resuelta.includes("no") && item.Resuelto === 1){
                matches = false;
            }
        }
        
        // Check previas (before date)
        if (previasDate && fecha > previasDate) {
            matches = false;
        }

        // Check posteriores (after date)
        if (posterioresDate && fecha < posterioresDate) {
            matches = false;
        }
        return matches;
    });
}
const clearDateButtons = document.querySelectorAll('.clear-date');

    // Function to clear the date input field
    function clearDateInput(event) {
        const targetId = event.target.getAttribute('data-target');
        const targetInput = document.getElementById(targetId);
        if (targetInput) {
            targetInput.value = ''; // Clear the date field
        }
    }

    // Add event listeners to clear date buttons
    clearDateButtons.forEach(button => {
        button.addEventListener('click', clearDateInput);
});
function sortTable(columnIndex, headerElement) {
    const table = document.getElementById("dynamic-table");
    const tbody = table.getElementsByTagName("tbody")[0];
    const rows = Array.from(tbody.getElementsByTagName("tr"));
    const isAscending = table.getAttribute('data-sort-order') === 'asc';
    
    // Sort rows
    rows.sort((a, b) => {
        const aText = a.getElementsByTagName("td")[columnIndex].innerText;
        const bText = b.getElementsByTagName("td")[columnIndex].innerText;
        
        if (aText < bText) return isAscending ? -1 : 1;
        if (aText > bText) return isAscending ? 1 : -1;
        return 0;
    });
    
    // Clear the table body and append sorted rows
    tbody.innerHTML = "";
    rows.forEach(row => tbody.appendChild(row));

    // Update sort order
    table.setAttribute('data-sort-order', isAscending ? 'desc' : 'asc');

    // Reset arrows and header styles
    const headers = table.getElementsByTagName("th");
    Array.from(headers).forEach(header => {
        const arrow = header.getElementsByClassName('arrow')[0];
        if (arrow) arrow.textContent = '▼'; // Reset arrow to down
        header.style.backgroundColor = "#f4f4f4"; // Reset header class
    });

    // Update arrow and header style for the current column
    const arrow = headerElement.getElementsByClassName('arrow')[0];
    if (arrow) arrow.textContent = isAscending ? '▲' : '▼';
    console.log(isAscending)
    headerElement.style.backgroundColor = isAscending ? "#8efda8": "#ff8791";
    
}

// Add event listener to the send button
sendButton.addEventListener('click', sendSelectedItems);

// Create the table rows on page load
window.addEventListener('load', getDBContents);
