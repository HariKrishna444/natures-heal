const catalogData = [
  {
    name: "Aloe Vera",
    type: "leaf",
    scientific: "Aloe barbadensis",
    uses: "Skin care, digestion",
    description: "Used for skin healing and hydration.",
    image: "https://images.unsplash.com/photo-1596547609652-9cf5d8d76921?auto=format&fit=crop&w=400&q=80"
  },
  {
    name: "Neem",
    type: "leaf",
    scientific: "Azadirachta indica",
    uses: "Antibacterial, dental care",
    description: "Known as natural medicine in India.",
    image: "https://images.unsplash.com/photo-1598514982841-3e7a7f3e9c3e?auto=format&fit=crop&w=400&q=80"
  },
  {
    name: "Mango",
    type: "fruit",
    scientific: "Mangifera indica",
    uses: "Rich in vitamins",
    description: "King of fruits in India.",
    image: "https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=400&q=80"
  }
];

const gridContainer = document.getElementById("gridContainer");
const itemCount = document.getElementById("itemCount");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const searchInput = document.getElementById("searchInput");

function renderItems(items) {

  if (items.length === 0) {
    gridContainer.innerHTML = `
      <div class="col-span-full text-center py-10">
        <h2 class="text-xl font-bold">No results found</h2>
      </div>`;
    itemCount.textContent = 0;
    return;
  }

  gridContainer.innerHTML = "";
  itemCount.textContent = items.length;

  items.forEach(item => {
    const card = document.createElement("div");

    card.className = "nature-card bg-white p-4 rounded shadow cursor-pointer";

    card.innerHTML = `
      <img loading="lazy" src="${item.image}" class="w-full h-40 object-cover rounded">
      <h3 class="text-lg font-bold mt-2">${item.name}</h3>
      <p class="text-sm text-gray-500">${item.scientific}</p>
      <span class="text-xs px-2 py-1 rounded ${
        item.type === 'leaf' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
      }">${item.type}</span>
    `;

    card.onclick = () => openModal(item);

    gridContainer.appendChild(card);
  });
}

function filterItems(type) {
  if (type === "all") {
    renderItems(catalogData);
  } else {
    renderItems(catalogData.filter(i => i.type === type));
  }
}

function openModal(item) {
  modalContent.innerHTML = `
    <h2 class="text-xl font-bold">${item.name}</h2>
    <p>${item.description}</p>
    <p><b>Uses:</b> ${item.uses}</p>
    <button onclick="closeModal()" class="mt-4 bg-black text-white px-4 py-2 rounded">Close</button>
  `;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

modal.onclick = (e) => {
  if (e.target === modal) closeModal();
};

searchInput.oninput = (e) => {
  const term = e.target.value.toLowerCase();
  localStorage.setItem("search", term);

  const filtered = catalogData.filter(item =>
    item.name.toLowerCase().includes(term) ||
    item.scientific.toLowerCase().includes(term) ||
    item.uses.toLowerCase().includes(term) ||
    item.description.toLowerCase().includes(term) ||
    item.type.toLowerCase().includes(term)
  );

  renderItems(filtered);
};

function toggleDark() {
  document.body.classList.toggle("bg-slate-900");
  document.body.classList.toggle("text-white");
}

window.onload = () => {
  const saved = localStorage.getItem("search");
  if (saved) {
    searchInput.value = saved;
  }
  renderItems(catalogData);
};
