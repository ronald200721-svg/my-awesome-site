let count = 0;
let clickPower = 1;
let autoClickRate = 0;

const upgrades = [
    { id: 'cursor', name: 'Курсор', bonusText: '+1 за клик', type: 'click', value: 1, price: 10, icon: '🖱️' },
    { id: 'helper', name: 'Помощник', bonusText: '+1 монета/сек', type: 'auto', value: 1, price: 50, icon: '👷' },
    { id: 'mine', name: 'Шахта', bonusText: '+2 за клик', type: 'click', value: 2, price: 200, icon: '⛏️' },
    { id: 'factory', name: 'Фабрика', bonusText: '+5 монет/сек', type: 'auto', value: 5, price: 300, icon: '🏭' },
    { id: 'rocket', name: 'Ракета', bonusText: '+20 монет/сек', type: 'auto', value: 20, price: 1500, icon: '🚀' },
    { id: 'lab', name: 'Лаборатория', bonusText: '+10 за клик', type: 'click', value: 10, price: 2000, icon: '🔬' },
    { id: 'portal', name: 'Портал', bonusText: '+100 монет/сек', type: 'auto', value: 100, price: 8000, icon: '🌀' }
];

const numberElement = document.getElementById('score');
const clickBtn = document.getElementById('click-btn');
const statPower = document.getElementById('stat-power');
const statAuto = document.getElementById('stat-auto');
const shopContainer = document.getElementById('shop');

function renderShop() {
    shopContainer.innerHTML = '';
    upgrades.forEach((item, index) => {
        const isAffordable = count >= item.price;
        
        const card = document.createElement('div');
        card.className = `upgrade-card ${isAffordable ? '' : 'disabled'}`;
        
        card.innerHTML = `
            <div class="upgrade-icon">${item.icon}</div>
            <div class="upgrade-info">
                <span class="upgrade-name">${item.name}</span>
                <span class="upgrade-bonus">${item.bonusText}</span>
                <span class="upgrade-price">💰 ${formatNumber(item.price)}</span>
            </div>
        `;
        
        card.onclick = () => buyUpgrade(index);
        shopContainer.appendChild(card);
    });
}

function buyUpgrade(index) {
    const item = upgrades[index];
    if (count >= item.price) {
        count -= item.price;
        
        if (item.type === 'click') {
            clickPower += item.value;
        } else {
            autoClickRate += item.value;
        }
        
        item.price = Math.floor(item.price * 1.4);
        
        updateDisplay();
        saveGame();
    }
}

function formatNumber(num) {
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num;
}

function updateDisplay() {
    numberElement.textContent = `💰 ${Math.floor(count)}`;
    statPower.textContent = clickPower;
    statAuto.textContent = autoClickRate;
    renderShop();
}

function showClickAnimation(x, y, amount) {
    const animationText = document.createElement('div');
    animationText.className = 'click-animation';
    animationText.textContent = `+${amount}`;
    animationText.style.left = `${x}px`;
    animationText.style.top = `${y}px`;
    document.body.appendChild(animationText);

    setTimeout(() => animationText.remove(), 800);
}

clickBtn.addEventListener('click', (event) => {
    count += clickPower;
    showClickAnimation(event.clientX, event.clientY, clickPower);
    updateDisplay();
    saveGame();
});

setInterval(() => {
    if (autoClickRate > 0) {
        count += autoClickRate;
        updateDisplay();
    }
}, 1000);

function saveGame() {
    const gameData = {
        count: count,
        clickPower: clickPower,
        autoClickRate: autoClickRate,
        upgrades: upgrades
    };
    localStorage.setItem('tyClickerSave', JSON.stringify(gameData));
}

function loadGame() {
    const savedData = localStorage.getItem('tyClickerSave');
    if (savedData) {
        const data = JSON.parse(savedData);
        count = data.count || 0;
        clickPower = data.clickPower || 1;
        autoClickRate = data.autoClickRate || 0;
        
        if (data.upgrades) {
            data.upgrades.forEach((savedItem, index) => {
                if (upgrades[index]) upgrades[index].price = savedItem.price;
            });
        }
    }
}

loadGame();
updateDisplay();