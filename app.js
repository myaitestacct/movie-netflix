// app.js

// --- DOM Elements ---
const contentArea = document.getElementById('content-area');
const searchInput = document.getElementById('search-input');
const btnGrid = document.getElementById('btn-grid');
const btnList = document.getElementById('btn-list');
const modal = document.getElementById('movie-modal');
const closeModal = document.getElementById('close-modal');
const modalBody = document.getElementById('modal-body');
const sortSelect = document.getElementById('sort-select');
const genreFilters = document.getElementById('genre-filters');

// Paripakva archive mode is toggled via Ctrl+Shift+K keyboard shortcut

// --- State ---
let currentView = 'grid';
let debounceTimer;
let currentQuery = '';
let currentOffset = 0;
let hasMoreResults = true;
let isLoading = false;
const currentLimit = 50;
let showParipakva = false; // archive/18+ content toggle (Ctrl+Shift+K)
let currentSort = 'num_asc'; // current sort order
let currentCategory = ''; // current genre filter ('' = all)
const FAVORITES_KEY = 'movielib_favorites';

// --- Helper: Get favorites from localStorage ---
function getFavorites() {
    try {
        return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
    } catch (e) {
        return [];
    }
}

// --- Helper: Toggle a movie in favorites ---
function toggleFavorite(num) {
    let favs = getFavorites();
    if (favs.includes(num)) {
        favs = favs.filter(n => n !== num);
    } else {
        favs.push(num);
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return favs.includes(num);
}

// --- Helper: Check if a movie is a favorite ---
function isFavorite(num) {
    return getFavorites().includes(num);
}

// --- Helper: Create DOM Element ---
function createElement(tag, className = '', textContent = '', attributes = {}) {
    const el = document.createElement(tag);
    if (className) className.split(' ').forEach(cls => el.classList.add(cls));
    if (textContent) el.textContent = textContent;
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
}

// --- Helper: Clear container ---
function clearContainer(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
}

// --- Helper: Escape HTML to prevent XSS ---
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Helper: Show loading spinner ---
function showLoadingSpinner() {
    const existing = contentArea.querySelector('.loading-spinner');
    if (existing) existing.remove();
    const spinner = createElement('div', 'loading-spinner');
    spinner.innerHTML = `
        <div class="spinner"></div>
        <div class="spinner-text">Loading movies...</div>
    `;
    contentArea.appendChild(spinner);
}

// --- Helper: Hide loading spinner ---
function hideLoadingSpinner() {
    const spinner = contentArea.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
}

// --- URL State: Save current state to URL hash ---
function updateURL() {
    const params = new URLSearchParams();
    if (searchInput.value) params.set('q', searchInput.value);
    if (currentSort !== 'num_asc') params.set('sort', currentSort);
    if (currentCategory === '__favorites__') params.set('favs', '1');
    else if (currentCategory) params.set('genre', currentCategory);
    if (showParipakva) params.set('archive', '1');

    const hash = params.toString();
    const newURL = hash ? `${window.location.pathname}#${hash}` : window.location.pathname;
    history.replaceState(null, '', newURL);
}

// --- URL State: Restore state from URL hash ---
function loadFromURL() {
    const hash = window.location.hash.slice(1); // remove #
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const q = params.get('q') || '';
    const sort = params.get('sort') || 'num_asc';
    const genre = params.get('genre') || '';
    const archive = params.get('archive') || '0';
    const favs = params.get('favs') || '0';

    searchInput.value = q;
    currentSort = sort;
    currentCategory = favs === '1' ? '__favorites__' : genre;
    showParipakva = archive === '1';

    // Sync sort dropdown
    sortSelect.value = currentSort;

    return true;
}

// --- Fetch and render stats dashboard ---
async function fetchStats() {
    const statsBar = document.getElementById('stats-bar');
    if (!statsBar) return;
    try {
        const includeArchive = showParipakva ? 1 : 0;
        const response = await fetch(`api.php?action=stats&archive=${includeArchive}`);
        if (!response.ok) return;
        const result = await response.json();
        const favCount = getFavorites().length;
        statsBar.innerHTML = `
            <div class="stat-item">
                <span class="stat-value">${result.totalMovies.toLocaleString()}</span>
                <span class="stat-label">Total Movies</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
                <span class="stat-value">${favCount}</span>
                <span class="stat-label">Favorites</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
                <span class="stat-value">⭐ ${result.avgRating}</span>
                <span class="stat-label">Avg Rating</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
                <span class="stat-value">${escapeHtml(result.topGenre)}</span>
                <span class="stat-label">Top Genre (${result.topGenreCount})</span>
            </div>
        `;
    } catch (err) {
        console.warn('Failed to load stats:', err);
    }
}

// --- Fetch and render genre filter chips ---
async function fetchCategories() {
    try {
        const includeArchive = showParipakva ? 1 : 0;
        const response = await fetch(`api.php?action=categories&archive=${includeArchive}`);
        if (!response.ok) return;
        const result = await response.json();
        const categories = result.categories || [];
        renderGenreChips(categories);
    } catch (err) {
        console.warn('Failed to load categories:', err);
    }
}

// --- Render genre chips ---
function renderGenreChips(categories) {
    clearContainer(genreFilters);

    // "All" chip
    const allChip = createElement('button', 'genre-chip' + (currentCategory === '' ? ' active' : ''), 'All');
    allChip.addEventListener('click', () => {
        currentCategory = '';
        updateActiveChip();
        fetchMovies(searchInput.value, 0, false);
    });
    genreFilters.appendChild(allChip);

    // "♥ Favorites" chip
    const favCount = getFavorites().length;
    const favChip = createElement('button', 'genre-chip fav-chip' + (currentCategory === '__favorites__' ? ' active' : ''), `♥ Favorites${favCount > 0 ? ' (' + favCount + ')' : ''}`);
    favChip.addEventListener('click', () => {
        if (currentCategory === '__favorites__') {
            currentCategory = '';
        } else {
            currentCategory = '__favorites__';
        }
        updateActiveChip();
        fetchMovies(searchInput.value, 0, false);
    });
    genreFilters.appendChild(favChip);

    categories.forEach(cat => {
        const chip = createElement('button', 'genre-chip' + (currentCategory === cat ? ' active' : ''), cat);
        chip.addEventListener('click', () => {
            if (currentCategory === cat) {
                currentCategory = '';
            } else {
                currentCategory = cat;
            }
            updateActiveChip();
            fetchMovies(searchInput.value, 0, false);
        });
        genreFilters.appendChild(chip);
    });
}

// --- Update breadcrumb navigation ---
function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;

    if (currentCategory === '' && !searchInput.value) {
        breadcrumb.innerHTML = '';
        breadcrumb.style.display = 'none';
        return;
    }

    breadcrumb.style.display = '';
    let html = '<span class="breadcrumb-item breadcrumb-root" data-action="all">All</span>';

    if (currentCategory === '__favorites__') {
        html += '<span class="breadcrumb-sep">›</span>';
        html += '<span class="breadcrumb-item breadcrumb-current">♥ Favorites</span>';
    } else if (currentCategory) {
        html += '<span class="breadcrumb-sep">›</span>';
        html += `<span class="breadcrumb-item breadcrumb-current">${escapeHtml(currentCategory)}</span>`;
    }

    if (searchInput.value) {
        html += '<span class="breadcrumb-sep">›</span>';
        html += `<span class="breadcrumb-item breadcrumb-current">"${escapeHtml(searchInput.value)}"</span>`;
    }

    breadcrumb.innerHTML = html;

    // "All" click resets everything
    const rootLink = breadcrumb.querySelector('.breadcrumb-root');
    if (rootLink) {
        rootLink.addEventListener('click', () => {
            currentCategory = '';
            searchInput.value = '';
            updateActiveChip();
            updateBreadcrumb();
            fetchMovies('', 0, false);
        });
    }
}

// --- Update active chip styling ---
function updateActiveChip() {
    genreFilters.querySelectorAll('.genre-chip').forEach(chip => {
        const isAll = chip.textContent === 'All';
        const isFav = chip.classList.contains('fav-chip');
        let isActive = false;
        if (currentCategory === '' && isAll) isActive = true;
        else if (currentCategory === '__favorites__' && isFav) isActive = true;
        else if (chip.textContent === currentCategory) isActive = true;
        chip.classList.toggle('active', isActive);
    });
}

// --- Fetch Movies from API ---
async function fetchMovies(query = '', offset = 0, append = false) {
    if (isLoading) return;
    isLoading = true;

    try {
        if (!append) {
            clearContainer(contentArea);
            currentOffset = 0;
            hasMoreResults = true;
            showLoadingSpinner();
        }

        const includeArchive = showParipakva ? 1 : 0;

        // Build category parameter
        let categoryParam = currentCategory;
        let favsParam = '';
        if (currentCategory === '__favorites__') {
            categoryParam = '';
            const favIds = getFavorites();
            favsParam = favIds.join(',');
        }

        const response = await fetch(
            `api.php?q=${encodeURIComponent(query)}&limit=${currentLimit}&offset=${offset}&archive=${includeArchive}&sort=${encodeURIComponent(currentSort)}&category=${encodeURIComponent(categoryParam)}&favs=${encodeURIComponent(favsParam)}`
        );
        
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const result = await response.json();
        const movies = result.movies || [];
        hasMoreResults = result.hasMore === true;

        hideLoadingSpinner();

        // Display total results
        const totalEl = document.getElementById('search-results-count');
        if (query && currentCategory === '__favorites__') {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} favorite(s) matching "${query}"`;
        } else if (query && currentCategory) {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} result(s) for "${query}" in ${currentCategory}`;
        } else if (query) {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} result(s) for "${query}"`;
        } else if (currentCategory === '__favorites__') {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} favorite(s)`;
        } else if (currentCategory) {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} in ${currentCategory}`;
        } else {
            const shownCount = append ? currentOffset + movies.length : movies.length;
            totalEl.textContent = `Showing ${shownCount} of ${result.totalMatches || 0} movies`;
        }

        // Remove loading indicator
        const loadingEl = contentArea.querySelector('.loading');
        if (loadingEl) loadingEl.remove();

        if (!append && movies.length === 0) {
            const noResultsDiv = createElement('div', 'no-results');
            const noResultsMessage = query ? `No movies found for "${query}". Try a different search or genre.` : 'No movies available. Start typing to search...';
            
            noResultsDiv.innerHTML = `
                <div class="no-results-illustration">
                    <svg width="180" height="160" viewBox="0 0 180 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <!-- Film reel -->
                        <rect x="50" y="30" width="80" height="100" rx="8" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
                        <circle cx="65" cy="45" r="5" fill="rgba(229,9,20,0.4)"/>
                        <circle cx="90" cy="45" r="5" fill="rgba(229,9,20,0.3)"/>
                        <circle cx="115" cy="45" r="5" fill="rgba(229,9,20,0.4)"/>
                        <circle cx="65" cy="115" r="5" fill="rgba(229,9,20,0.3)"/>
                        <circle cx="90" cy="115" r="5" fill="rgba(229,9,20,0.4)"/>
                        <circle cx="115" cy="115" r="5" fill="rgba(229,9,20,0.3)"/>
                        <!-- Magnifying glass -->
                        <circle cx="90" cy="75" r="22" stroke="rgba(255,255,255,0.25)" stroke-width="3" fill="none"/>
                        <line x1="106" y1="91" x2="120" y2="105" stroke="rgba(255,255,255,0.25)" stroke-width="3" stroke-linecap="round"/>
                        <!-- Question mark inside glass -->
                        <text x="82" y="83" font-size="24" font-weight="bold" fill="rgba(229,9,20,0.6)">?</text>
                        <!-- Stars -->
                        <circle cx="25" cy="50" r="2" fill="rgba(255,255,255,0.2)"/>
                        <circle cx="155" cy="40" r="1.5" fill="rgba(255,255,255,0.15)"/>
                        <circle cx="30" cy="110" r="1" fill="rgba(255,255,255,0.1)"/>
                        <circle cx="150" cy="120" r="2" fill="rgba(255,255,255,0.15)"/>
                    </svg>
                </div>
                <h2 class="no-results-title">No results found</h2>
                <p class="no-results-message">${noResultsMessage}</p>
                <div class="no-results-tips">
                    <span class="tip-label">Tips:</span>
                    <ul>
                        <li>Check for typos in your search</li>
                        <li>Try broader keywords</li>
                        <li>Try a different genre filter</li>
                        <li>Check a different sort order</li>
                    </ul>
                </div>
                <button class="no-results-reset-btn">Clear Search &amp; Filters</button>
            `;
            
            Object.assign(noResultsDiv.style, { gridColumn: '1 / -1' });
            contentArea.appendChild(noResultsDiv);
            
            // Attach reset button handler
            const resetBtn = noResultsDiv.querySelector('.no-results-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    currentQuery = '';
                    currentCategory = '';
                    searchInput.value = '';
                    renderGenreChips();
                    sortSelect.value = 'num_asc';
                    currentSort = 'num_asc';
                    currentOffset = 0;
                    fetchMovies('', 0, false);
                });
            }
            
            isLoading = false;
            updateBreadcrumb();
            return;
        }

        if (currentView === 'grid') renderGrid(movies, append);
        else renderTable(movies, append);

        if (hasMoreResults) addLoadMoreButton();
        else {
            const btn = contentArea.querySelector('.load-more-btn');
            if (btn) btn.remove();
        }

        currentQuery = query;
        currentOffset = result.nextOffset || offset + movies.length;

        // Update breadcrumb
        updateBreadcrumb();

        // Save state to URL
        updateURL();
    } catch (err) {
        console.error('Fetch error:', err);
        hideLoadingSpinner();
        if (!append) {
            clearContainer(contentArea);
            const errEl = createElement('div', 'error', 'Error: ' + err.message);
            Object.assign(errEl.style, { gridColumn: '1 / -1', padding: '2rem', color: 'var(--accent)', textAlign: 'center' });
            contentArea.appendChild(errEl);
        }
    } finally {
        isLoading = false;
    }
}

// --- Load More Button ---
function addLoadMoreButton() {
    const existing = contentArea.querySelector('.load-more-btn');
    if (existing) existing.remove();

    const btn = createElement('button', 'load-more-btn', 'Load More Movies');
    btn.style.gridColumn = '1 / -1';
    btn.addEventListener('click', () => {
        // Remember where the button is so we can scroll to new content
        const scrollTarget = btn.offsetTop - 20;

        btn.disabled = true;
        btn.textContent = 'Loading...';
        fetchMovies(currentQuery, currentOffset, true).finally(() => {
            // Remove the old button (a new one will be added by fetchMovies)
            if (btn.parentNode) btn.remove();

            // Smooth scroll to where new content starts
            contentArea.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        });
    });
    contentArea.appendChild(btn);
}

// --- Render Grid ---
function renderGrid(movies, append = false) {

    let grid = contentArea.querySelector('.movie-grid');

    if (!grid || !append) {
        grid = createElement('div','movie-grid');
        if(!append) clearContainer(contentArea);
        contentArea.appendChild(grid);
    }

    movies.forEach(movie => {

        const card = createElement('div','movie-card');
        card.dataset.num = movie.num;

        /* POSTER WRAPPER */

        const posterWrapper = createElement('div','poster-wrapper loading');

        const glow = createElement('div','poster-glow');
        posterWrapper.appendChild(glow);

        const img = createElement('img');

        img.src = movie.poster || 'placeholder.jpg';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = movie.formattedtitle || movie.title || 'Movie Poster';

        img.onerror = () => {
            img.onerror = null; // prevent infinite loop
            img.src = 'data:image/svg+xml,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
                    <rect width="200" height="300" fill="#1a1a1a"/>
                    <g transform="translate(100,130)" fill="none" stroke="#444" stroke-width="2">
                        <rect x="-25" y="-35" width="50" height="70" rx="4"/>
                        <circle cx="0" cy="-10" r="12"/>
                        <path d="M-18 25 L-8 10 L0 18 L8 5 L18 25"/>
                    </g>
                    <text x="100" y="200" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="12">No Poster</text>
                </svg>
            `);
            posterWrapper.classList.remove('loading');
            posterWrapper.classList.add('loaded');
        };

        img.onload = () => {
            posterWrapper.classList.remove('loading');
            posterWrapper.classList.add('loaded');

            try{
                getPosterGlow(img, glow);
            }catch(e){
                console.warn('Glow skipped:',e);
            }
        };
        
        // Add source badge
        if (movie.source === 'paripakva') {
            const sourceBadge = createElement('div','movie-badge badge-source','18+');
            sourceBadge.style.backgroundColor = 'purple';
            sourceBadge.style.color = '#fff';
            posterWrapper.appendChild(sourceBadge);
        }

        posterWrapper.appendChild(img);

        /* BADGES */

        const createBadge = (text, cls) => {
            const badge = createElement('div',`movie-badge ${cls}`);
            badge.textContent = text;
            return badge;
        };

        /* CERTIFICATION */

        if(movie.certification){
            posterWrapper.appendChild(
                createBadge(`🎬 ${movie.certification}`,'badge-cert')
            );
        }

        /* LENGTH */

        if(movie.length){
            posterWrapper.appendChild(
                createBadge(`⏱ ${movie.length}`,'badge-length')
            );
        }

        /* RATING */

        const ratingVal = parseFloat(movie.rating) || 0;

        if(ratingVal > 0){

            const ratingBadge = createBadge(`⭐ ${ratingVal.toFixed(1)}`,'badge-rating');

            if(movie.external_url){

                ratingBadge.style.cursor='pointer';
                ratingBadge.title='Open external rating';

                ratingBadge.addEventListener('click',e=>{
                    e.stopPropagation();
                    window.open(movie.external_url,'_blank');
                });

            }

            posterWrapper.appendChild(ratingBadge);
        }

        /* YEAR */

        if(movie.year){
            posterWrapper.appendChild(
                createBadge(`📅 ${movie.year}`,'badge-year')
            );
        }

        // --- Hover Info (Netflix-style) ---
        const hoverInfo = createElement('div', 'hover-info');
        const descSize = 180;
        hoverInfo.textContent = movie.description 
            ? (movie.description.length > descSize ? movie.description.slice(0, descSize) + '…' : movie.description)
            : 'No description available.';
        posterWrapper.appendChild(hoverInfo);
        
        /* INFO SECTION */

        const info = createElement('div','card-info');

        const titleText = `${movie.num} - ${movie.title}`;

        const title = createElement('div','card-title',titleText);
        title.setAttribute('title',titleText);

        title.style.whiteSpace='normal';
        title.style.wordBreak='break-word';

        const meta = createElement('div','card-meta');

        if(movie.genre){
            meta.appendChild(createElement('span','',movie.genre));
        }

        info.append(title,meta);

        card.append(posterWrapper,info);

        // Favorite heart button
        const favBtn = createElement('button', 'fav-btn' + (isFavorite(movie.num) ? ' active' : ''), '♥');
        favBtn.title = isFavorite(movie.num) ? 'Remove from favorites' : 'Add to favorites';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowFav = toggleFavorite(movie.num);
            favBtn.classList.toggle('active', nowFav);
            favBtn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
            // Refresh stats and favorites chip count
            fetchStats();
            // Update favorites chip count
            const favChipEl = genreFilters.querySelector('.fav-chip');
            if (favChipEl) {
                const cnt = getFavorites().length;
                favChipEl.textContent = `♥ Favorites${cnt > 0 ? ' (' + cnt + ')' : ''}`;
            }
            // If viewing favorites, refresh the list
            if (currentCategory === '__favorites__') {
                fetchMovies(searchInput.value, 0, false);
            }
        });
        card.appendChild(favBtn);

        card.addEventListener('click',()=>openModal(movie));

        grid.appendChild(card);

    });

}

// --- Poster Glow ---
function getPosterGlow(img, glowEl){

    if(!img.complete || img.naturalWidth === 0) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d',{willReadFrequently:true});

    canvas.width = 20;
    canvas.height = 20;

    ctx.drawImage(img,0,0,20,20);

    const pixels = ctx.getImageData(0,0,20,20).data;

    let r=0,g=0,b=0,count=0;

    for(let i=0;i<pixels.length;i+=4){

        r+=pixels[i];
        g+=pixels[i+1];
        b+=pixels[i+2];
        count++;

    }

    r=Math.floor(r/count);
    g=Math.floor(g/count);
    b=Math.floor(b/count);

    glowEl.style.background =
        `radial-gradient(circle, rgba(${r},${g},${b},0.65) 0%, transparent 70%)`;
}

// --- Render Table ---
function renderTable(movies, append = false) {
    let table = contentArea.querySelector('.movie-table');
    let tbody = table ? table.querySelector('tbody') : null;

    if (!table || !append) {
        table = createElement('table', 'movie-table');
        const thead = createElement('thead');
        tbody = createElement('tbody');

        const headerRow = createElement('tr');
        ['', '#', 'Cover', 'Title', 'Certification', 'Year', 'Category', 'Rating'].forEach(h => {
            headerRow.appendChild(createElement('th', '', h));
        });
        thead.appendChild(headerRow);
        table.append(thead, tbody);
        if (!append) clearContainer(contentArea);
        contentArea.appendChild(table);
    }

    movies.forEach(movie => {
        const row = createElement('tr');
        row.dataset.num = movie.num;

        // Favorite heart cell
        const tdFav = createElement('td');
        const favBtn = createElement('button', 'fav-btn' + (isFavorite(movie.num) ? ' active' : ''), '♥');
        favBtn.title = isFavorite(movie.num) ? 'Remove from favorites' : 'Add to favorites';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowFav = toggleFavorite(movie.num);
            favBtn.classList.toggle('active', nowFav);
            favBtn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
            fetchStats();
            const favChipEl = genreFilters.querySelector('.fav-chip');
            if (favChipEl) {
                const cnt = getFavorites().length;
                favChipEl.textContent = `♥ Favorites${cnt > 0 ? ' (' + cnt + ')' : ''}`;
            }
            if (currentCategory === '__favorites__') {
                fetchMovies(searchInput.value, 0, false);
            }
        });
        tdFav.appendChild(favBtn);

        const tdNum = createElement('td', 'num-cell', `#${movie.num}`);
        Object.assign(tdNum.style, { fontWeight: '600', color: 'var(--accent)', minWidth: '50px' });

        const tdImg = createElement('td');
        const img = createElement('img', 'table-poster', '', { src: movie.poster, loading: 'lazy' });
        img.onerror = () => {
            img.onerror = null;
            img.src = 'data:image/svg+xml,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="60" viewBox="0 0 40 60">
                    <rect width="40" height="60" fill="#1a1a1a"/>
                    <text x="20" y="35" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="8">N/A</text>
                </svg>
            `);
        };
        tdImg.appendChild(img);

        const tdTitle = createElement('td', '', movie.title);
        const tdCert = createElement('td', '', movie.certification);
        const tdYear = createElement('td', '', movie.year);
        const tdGenre = createElement('td', '', movie.genre);

        const tdRating = createElement('td');
        const ratingVal = parseFloat(movie.rating) || 0;
        const ratingText = ratingVal > 0 ? `★ ${ratingVal}` : '-';

        if (movie.external_url && ratingVal > 0) {
            const link = createElement('a', '', ratingText, {
                href: movie.external_url,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: 'Open external link'
            });
            Object.assign(link.style, { color: 'var(--accent)', textDecoration: 'none' });
            link.addEventListener('click', e => e.stopPropagation());
            tdRating.appendChild(link);
        } else {
            tdRating.textContent = ratingText;
            if (ratingVal === 0) tdRating.style.opacity = '0.5';
        }
        
        // Add source badge for paripakva in table view
        if (movie.source === 'paripakva') {
            const sourceBadge = createElement('span', '', '18+');
            Object.assign(sourceBadge.style, {
                backgroundColor: 'purple',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: '600',
                marginLeft: '6px'
            });
            tdTitle.appendChild(sourceBadge);
        }

        row.append(tdFav, tdNum, tdImg, tdTitle, tdCert, tdYear, tdGenre, tdRating);
        row.dataset.poster = movie.poster;
        row.addEventListener('click', () => openModal(movie));

        // Poster preview on hover
        row.addEventListener('mouseenter', (e) => {
            showTablePosterPreview(movie.poster, e);
        });
        row.addEventListener('mousemove', (e) => {
            moveTablePosterPreview(e);
        });
        row.addEventListener('mouseleave', () => {
            hideTablePosterPreview();
        });

        tbody.appendChild(row);
    });
}

// --- Modal ---
function openModal(movie) {
    clearContainer(modalBody);

    // Modal header (background poster)
    const header = createElement('div', 'modal-header');
    header.style.backgroundImage = `url(${movie.poster})`;

    // Header top row (ID + title)
    const headerTop = createElement('div', 'modal-header-top');
    const title = createElement('h2');
    title.append(createElement('span', 'modal-num', `#${movie.num}`), document.createTextNode(movie.title));
    headerTop.appendChild(title);

    // Modal content row: flex container
    const contentRow = createElement('div', 'modal-content-row');

    // Poster (sticky on left)
    const posterWrapper = createElement('div', 'modal-poster-wrapper');

    // Make poster clickable to open lightbox
    const posterImg = createElement('img', 'modal-img', '', { src: movie.poster, alt: movie.title });
    posterImg.style.cursor = 'pointer';

    posterImg.onerror = () => {
        posterImg.onerror = null;
        posterImg.src = 'data:image/svg+xml,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="350" height="500" viewBox="0 0 350 500">
                <rect width="350" height="500" fill="#1a1a1a"/>
                <g transform="translate(175,220)" fill="none" stroke="#444" stroke-width="2">
                    <rect x="-35" y="-50" width="70" height="100" rx="6"/>
                    <circle cx="0" cy="-18" r="18"/>
                    <path d="M-28 38 L-14 15 L0 28 L14 8 L28 38"/>
                </g>
                <text x="175" y="340" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="16">No Poster Available</text>
            </svg>
        `);
    };

    posterImg.addEventListener('click', () => {
        const lightbox = document.getElementById('poster-lightbox');
        const lightboxImg = lightbox.querySelector('.lightbox-img');
        lightboxImg.src = movie.poster;
        lightbox.classList.add('show');
    });

    posterWrapper.appendChild(posterImg);

    if (movie.certification) {
        const badge = createCertificationBadge(movie.certification);
        posterWrapper.appendChild(badge);
    }

    contentRow.appendChild(posterWrapper);

    // Details column (scrollable)
    const details = createElement('div', 'modal-details');

    // Meta info
    const meta = createElement('div', 'modal-meta');
    if (movie.year) meta.appendChild(createElement('span', '', movie.year));
    if (movie.genre) meta.appendChild(createElement('span', '', movie.genre));
    if (movie.length) {
        const lengthSpan = createElement('span');
        lengthSpan.innerHTML = `
            <svg class="tech-icon" width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" style="vertical-align:middle;margin-right:4px;">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${escapeHtml(movie.length)}
        `;
        meta.appendChild(lengthSpan);
    }

    const ratingVal = parseFloat(movie.rating) || 0;
    const ratingText = ratingVal > 0 ? `★ ${ratingVal}` : '-';
    const rating = movie.external_url && ratingVal > 0
        ? createElement('a', 'rating-badge', ratingText, { href: movie.external_url, target: '_blank', rel: 'noopener noreferrer', title: 'Open external link' })
        : createElement('span', 'rating-badge', ratingText);
    if (!rating.href && ratingVal === 0) rating.style.opacity = '0.5';
    if (rating.href) rating.style.cursor = 'pointer';
    meta.appendChild(rating);

    // Synopsis / director / cast
    details.append(
        meta,
        createElement('span', 'modal-label', 'SYNOPSIS'),
        createElement('p', 'modal-desc', movie.description || 'No description available.'),
        createElement('span', 'modal-label', 'DIRECTOR'),
        createElement('p', 'modal-director', movie.director || 'Unknown'),
        createElement('span', 'modal-label', 'CAST'),
        createElement('p', 'modal-cast', movie.actors || 'Unknown')
    );

    // Tech details
    const techSection = createElement('div', 'tech-details');
    const inlineRow = createElement('div', 'tech-row-inline');

    const resolutionItem = createElement('div', 'tech-item');
    resolutionItem.innerHTML = `<svg class="tech-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" style="margin-right:6px;"><rect x="2" y="4" width="20" height="14" rx="2"></rect><line x1="8" y1="20" x2="16" y2="20"></line></svg><span class="tech-value">${escapeHtml(movie.resolution) || 'N/A'}</span>`;
    const audioItem = createElement('div', 'tech-item');
    audioItem.innerHTML = `<svg class="tech-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" style="margin-right:6px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15 9a4 4 0 010 6"></path></svg><span class="tech-value">${escapeHtml(movie.audio) || 'N/A'}</span>`;
    const sizeItem = createElement('div', 'tech-item');
    sizeItem.innerHTML = `<svg class="tech-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" style="margin-right:6px;"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M8 12h8"></path></svg><span class="tech-value">${escapeHtml(movie.size) || 'N/A'}</span>`;

    inlineRow.append(sizeItem, resolutionItem, audioItem);
    techSection.appendChild(inlineRow);

    // File row
    if (movie.filepath) {
        const fullPath = movie.filepath.replace(/\\/g, '/');
        const lastSlash = fullPath.lastIndexOf('/');
        const fileName = lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;

        const fileWrapper = createElement('div', 'tech-file-wrapper');
        fileWrapper.style.marginTop = '0';

        const fileRow = createElement('div', 'tech-item tech-file-row');
        fileRow.innerHTML = `
            <svg class="tech-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="tech-file-name">${escapeHtml(fileName) || 'N/A'}</span>
            <button class="copy-file-btn" title="Copy file name">Copy</button>
        `;
        const copyBtn = fileRow.querySelector('.copy-file-btn');
        copyBtn.addEventListener('click', e => {
            e.stopPropagation();
            navigator.clipboard.writeText(fileName).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy', 1200);
            });
        });

        fileWrapper.appendChild(fileRow);
        techSection.appendChild(fileWrapper);
    }

    details.appendChild(techSection);
    contentRow.appendChild(details);
    header.append(headerTop, contentRow);
    modalBody.appendChild(header);

    modal.showModal();
}

const lightbox = document.getElementById('poster-lightbox');
const closeBtn = lightbox.querySelector('.close-lightbox');

function closeLightbox() {
    lightbox.classList.remove('show');
}

closeBtn.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox();
});

// --- Event Listeners ---
searchInput.addEventListener('input', e => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchMovies(e.target.value, 0, false), 400);
});

sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    fetchMovies(searchInput.value, 0, false);
});

btnGrid.addEventListener('click', () => {
    if (currentView !== 'grid') {
        currentView = 'grid';
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
        fetchMovies(searchInput.value, 0, false);
    }
});

btnList.addEventListener('click', () => {
    if (currentView !== 'list') {
        currentView = 'list';
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
        fetchMovies(searchInput.value, 0, false);
    }
});

function smoothClose() {
    modal.classList.add('closing');
    setTimeout(() => {
        modal.classList.remove('closing');
        modal.close();
    }, 260);
}

closeModal.addEventListener('click', smoothClose);
modal.addEventListener('click', e => { if (e.target === modal) smoothClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.open) smoothClose(); });

// --- Back to Top Button ---
const backToTopBtn = createElement('button', 'back-to-top-btn');
backToTopBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
`;
backToTopBtn.title = 'Back to top';
backToTopBtn.addEventListener('click', () => {
    contentArea.scrollTo({ top: 0, behavior: 'smooth' });
});
document.body.appendChild(backToTopBtn);

// Show/hide based on scroll position + infinite scroll
contentArea.addEventListener('scroll', () => {
    if (contentArea.scrollTop > 400) {
        backToTopBtn.classList.add('visible');
    } else {
        backToTopBtn.classList.remove('visible');
    }

    // Infinite scroll: auto-load when near bottom
    const scrollThreshold = 300;
    const distanceFromBottom = contentArea.scrollHeight - contentArea.scrollTop - contentArea.clientHeight;
    if (distanceFromBottom < scrollThreshold && hasMoreResults && !isLoading) {
        const loadBtn = contentArea.querySelector('.load-more-btn');
        if (loadBtn && !loadBtn.disabled) {
            loadBtn.disabled = true;
            loadBtn.textContent = 'Loading...';
            fetchMovies(currentQuery, currentOffset, true);
        }
    }
});

// --- Certification Badge ---
function createCertificationBadge(certText) {
    if (!certText) return null;
    const badge = createElement('div', 'cert-badge', 'Rated: ' + certText);
    return badge;
}

document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+K: Toggle paripakva archive
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') {
        showParipakva = !showParipakva;
        currentCategory = '';
        fetchCategories();
        fetchMovies(searchInput.value, 0, false);
        console.log(`Paripakva ${showParipakva ? 'enabled' : 'disabled'}`);
    }

    // ?: Show keyboard shortcuts overlay
    if (e.key === '?' && !modal.open && document.activeElement !== searchInput) {
        showShortcutsOverlay();
    }

    // / or Ctrl+K: Focus search input
    if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
    }

    // Escape: Clear search if search is focused and has text
    if (e.key === 'Escape' && document.activeElement === searchInput && searchInput.value) {
        searchInput.value = '';
        fetchMovies('', 0, false);
        searchInput.blur();
    }

    // 1: Switch to grid view
    if (e.key === '1' && document.activeElement !== searchInput) {
        btnGrid.click();
    }

    // 2: Switch to list view
    if (e.key === '2' && document.activeElement !== searchInput) {
        btnList.click();
    }
});

// --- Table Poster Preview on Hover ---
let tablePreviewEl = null;

function showTablePosterPreview(posterUrl, e) {
    if (!posterUrl) return;
    hideTablePosterPreview();
    tablePreviewEl = document.createElement('div');
    tablePreviewEl.className = 'table-poster-preview';
    const img = document.createElement('img');
    img.src = posterUrl;
    img.alt = 'Poster preview';
    tablePreviewEl.appendChild(img);
    document.body.appendChild(tablePreviewEl);
    moveTablePosterPreview(e);
}

function moveTablePosterPreview(e) {
    if (!tablePreviewEl) return;
    const previewWidth = 200;
    const previewHeight = 300;
    let x = e.clientX + 20;
    let y = e.clientY - previewHeight / 2;
    // Keep within viewport
    if (x + previewWidth > window.innerWidth) x = e.clientX - previewWidth - 20;
    if (y < 10) y = 10;
    if (y + previewHeight > window.innerHeight) y = window.innerHeight - previewHeight - 10;
    tablePreviewEl.style.left = x + 'px';
    tablePreviewEl.style.top = y + 'px';
}

function hideTablePosterPreview() {
    if (tablePreviewEl) {
        tablePreviewEl.remove();
        tablePreviewEl = null;
    }
}

// --- Theme Toggle ---
const THEME_KEY = 'movielib_theme';
const btnTheme = document.getElementById('btn-theme');
const iconMoon = btnTheme.querySelector('.icon-moon');
const iconSun = btnTheme.querySelector('.icon-sun');

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        iconMoon.style.display = 'none';
        iconSun.style.display = '';
    } else {
        document.body.classList.remove('light-theme');
        iconMoon.style.display = '';
        iconSun.style.display = 'none';
    }
    localStorage.setItem(THEME_KEY, theme);
}

// Load saved theme on start
const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
applyTheme(savedTheme);

btnTheme.addEventListener('click', () => {
    const current = document.body.classList.contains('light-theme') ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
});

// --- Keyboard Shortcuts Overlay ---
function showShortcutsOverlay() {
    const existing = document.querySelector('.shortcuts-overlay');
    if (existing) existing.remove();

    const overlay = createElement('div', 'shortcuts-overlay');
    overlay.innerHTML = `
        <div class="shortcuts-panel">
            <div class="shortcuts-header">
                <h3>Keyboard Shortcuts</h3>
                <button class="shortcuts-close">&times;</button>
            </div>
            <div class="shortcuts-body">
                <div class="shortcut-row"><kbd>/</kbd> or <kbd>Ctrl+K</kbd> <span>Focus search</span></div>
                <div class="shortcut-row"><kbd>Esc</kbd> <span>Clear search / Close modal</span></div>
                <div class="shortcut-row"><kbd>1</kbd> <span>Grid view</span></div>
                <div class="shortcut-row"><kbd>2</kbd> <span>List view</span></div>
                <div class="shortcut-row"><kbd>Ctrl+Shift+K</kbd> <span>Toggle archive mode</span></div>
                <div class="shortcut-row"><kbd>?</kbd> <span>Show this help</span></div>
            </div>
        </div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('shortcuts-close')) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);
}


// --- Initial Load ---
// Restore state from URL hash (bookmarkable/shareable links)
loadFromURL();
fetchCategories();
fetchStats();
fetchMovies(searchInput.value, 0, false);

// Handle browser back/forward buttons
window.addEventListener('hashchange', () => {
    loadFromURL();
    fetchMovies(searchInput.value, 0, false);
});
