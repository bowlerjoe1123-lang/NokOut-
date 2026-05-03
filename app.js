(() => {
  const dataBundle = window.POKEMON_TCG_DATA;

  const STORAGE_KEYS = {
    collection: "pokemon-card-sim.collection.v3",
    booklets: "pokemon-card-sim.booklets.v1",
    priceCache: "pokemon-card-sim.price-cache.v4",
    progress: "pokemon-card-sim.progress.v2"
  };

  const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const REVEAL_PREVIEW_MS = 1000;
  const REVEAL_DROP_MS = 920;
  const PACK_CUT_MS = 660;
  const PACK_SIZE = 10;
  const RANDOM_PACK_ID = "random";
  const PACK_DETAIL_RANDOM_SAMPLE_SIZE = 96;
  const POKEMON_CARD_BACK_URL = "./pokemon-card-back.svg";

  const elements = {
    menuScreen: document.querySelector("#menu-screen"),
    packsScreen: document.querySelector("#packs-screen"),
    packScreen: document.querySelector("#pack-screen"),
    collectionScreen: document.querySelector("#collection-screen"),
    openPackButton: document.querySelector("#open-pack-button"),
    openCollectionButton: document.querySelector("#open-collection-button"),
    packsBackButton: document.querySelector("#packs-back-button"),
    packsSearchInput: document.querySelector("#packs-search-input"),
    packsGrid: document.querySelector("#packs-grid"),
    packDetail: document.querySelector("#pack-detail"),
    bookletActiveName: document.querySelector("#booklet-active-name"),
    bookletPreview: document.querySelector("#booklet-preview"),
    packFadeOverlay: document.querySelector("#pack-fade-overlay"),
    packProgress: document.querySelector("#pack-progress"),
    packInstruction: document.querySelector("#pack-instruction"),
    packStage: document.querySelector("#pack-stage"),
    packStageContent: document.querySelector("#pack-stage-content"),
    packSummaryHeading: document.querySelector("#pack-summary-heading"),
    revealedTray: document.querySelector("#revealed-tray"),
    packSummaryActions: document.querySelector("#pack-summary-actions"),
    packOpenAnotherButton: document.querySelector("#pack-open-another-button"),
    packBackToPacksButton: document.querySelector("#pack-back-to-packs-button"),
    collectionBackButton: document.querySelector("#collection-back-button"),
    pricingStatus: document.querySelector("#pricing-status"),
    allFilterButton: document.querySelector("#all-filter-button"),
    favoritesFilterButton: document.querySelector("#favorites-filter-button"),
    collectionSearchInput: document.querySelector("#collection-search-input"),
    collectionSortSelect: document.querySelector("#collection-sort-select"),
    refreshPricesButton: document.querySelector("#refresh-prices-button"),
    clearCollectionButton: document.querySelector("#clear-collection-button"),
    collectionPacksOpenedCount: document.querySelector("#collection-packs-opened-count"),
    collectionSavedCount: document.querySelector("#collection-saved-count"),
    collectionFavoriteCount: document.querySelector("#collection-favorite-count"),
    collectionBookletCount: document.querySelector("#collection-booklet-count"),
    collectionGrid: document.querySelector("#collection-grid"),
    cardZoomModal: document.querySelector("#card-zoom-modal"),
    cardZoomBackdrop: document.querySelector("#card-zoom-backdrop"),
    cardZoomClose: document.querySelector("#card-zoom-close"),
    cardZoomContent: document.querySelector("#card-zoom-content")
  };

  const state = {
    cards: [],
    cardById: new Map(),
    packs: [],
    packById: new Map(),
    selectedPackId: RANDOM_PACK_ID,
    packSearch: "",
    currentView: "menu",
    currentPack: null,
    packBuildInFlight: false,
    packsOpened: 0,
    collection: {},
    booklets: {},
    activeBookletId: null,
    priceCache: {},
    collectionFilter: "all",
    collectionSort: "price-desc",
    collectionSearch: "",
    zoomedCardId: null,
    rawPriceQueue: [],
    rawPriceLookupInFlight: false,
    revealPreviewTimerId: null,
    revealDropTimerId: null
  };

  function getStartupConfig() {
    const params = new URLSearchParams(window.location.search);
    const requestedPacks = Number.parseInt(params.get("packs") || "0", 10);

    return {
      openPack: Number.isFinite(requestedPacks) && requestedPacks > 0,
      revealAll: params.get("reveal") === "all",
      view: params.get("view") === "collection"
        ? "collection"
        : params.get("view") === "pack"
          ? "pack"
          : params.get("view") === "packs"
            ? "packs"
            : "menu"
    };
  }

  function safeParse(jsonText, fallback) {
    try {
      return JSON.parse(jsonText);
    }
    catch {
      return fallback;
    }
  }

  function normalizeStoredCollection(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value).reduce((next, [cardId, record]) => {
      if (!record || typeof record !== "object") {
        return next;
      }

      const count = Math.max(0, Number.parseInt(record.count, 10) || 0);
      if (!count) {
        return next;
      }

      const now = new Date().toISOString();
      next[cardId] = {
        count,
        favorite: Boolean(record.favorite),
        firstSavedAt: typeof record.firstSavedAt === "string" ? record.firstSavedAt : now,
        savedAt: typeof record.savedAt === "string" ? record.savedAt : now
      };
      return next;
    }, {});
  }

  function normalizeStoredBooklets(value) {
    const source = Array.isArray(value)
      ? value.reduce((map, booklet) => {
          if (booklet && typeof booklet === "object") {
            const id = typeof booklet.id === "string" ? booklet.id : "";
            if (id) {
              map[id] = booklet;
            }
          }
          return map;
        }, {})
      : value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};

    return Object.entries(source).reduce((next, [fallbackId, booklet], index) => {
      if (!booklet || typeof booklet !== "object") {
        return next;
      }

      const id = typeof booklet.id === "string" && booklet.id.trim()
        ? booklet.id.trim()
        : fallbackId;
      if (!id) {
        return next;
      }

      const name = typeof booklet.name === "string" && booklet.name.trim()
        ? booklet.name.trim()
        : `Booklet ${index + 1}`;
      const cardIds = Array.isArray(booklet.cardIds)
        ? Array.from(new Set(booklet.cardIds.filter((cardId) => typeof cardId === "string" && cardId.trim())))
        : [];
      const createdAt = typeof booklet.createdAt === "string"
        ? booklet.createdAt
        : new Date().toISOString();
      const updatedAt = typeof booklet.updatedAt === "string"
        ? booklet.updatedAt
        : createdAt;

      next[id] = {
        id,
        name,
        cardIds,
        createdAt,
        updatedAt
      };
      return next;
    }, {});
  }

  function loadStoredState() {
    state.collection = normalizeStoredCollection(
      safeParse(localStorage.getItem(STORAGE_KEYS.collection) || "{}", {})
    );
    state.booklets = normalizeStoredBooklets(
      safeParse(localStorage.getItem(STORAGE_KEYS.booklets) || "{}", {})
    );
    state.priceCache = safeParse(localStorage.getItem(STORAGE_KEYS.priceCache) || "{}", {});

    const progress = safeParse(localStorage.getItem(STORAGE_KEYS.progress) || "{}", {});
    state.packsOpened = Number.parseInt(progress.packsOpened, 10) || 0;
    state.activeBookletId = typeof progress.activeBookletId === "string" ? progress.activeBookletId : null;
    state.selectedPackId = typeof progress.selectedPackId === "string" ? progress.selectedPackId : RANDOM_PACK_ID;
  }

  function saveCollectionState() {
    localStorage.setItem(STORAGE_KEYS.collection, JSON.stringify(state.collection));
  }

  function saveBookletsState() {
    localStorage.setItem(STORAGE_KEYS.booklets, JSON.stringify(state.booklets));
  }

  function savePriceCacheState() {
    localStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify(state.priceCache));
  }

  function saveProgressState() {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({
      packsOpened: state.packsOpened,
      activeBookletId: state.activeBookletId,
      selectedPackId: state.selectedPackId
    }));
  }

  function getBookletsArray() {
    return Object.values(state.booklets).sort((left, right) => {
      const timeDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return left.name.localeCompare(right.name);
    });
  }

  function ensureActiveBookletId() {
    const orderedBooklets = getBookletsArray();
    const nextId = orderedBooklets.length
      ? (state.activeBookletId && state.booklets[state.activeBookletId]
          ? state.activeBookletId
          : orderedBooklets[0].id)
      : null;
    const changed = state.activeBookletId !== nextId;
    state.activeBookletId = nextId;
    return changed;
  }

  function sanitizeStoredStateAgainstCatalog() {
    let collectionChanged = false;
    let bookletsChanged = false;

    state.collection = Object.entries(state.collection).reduce((next, [cardId, record]) => {
      if (!state.cardById.has(cardId)) {
        collectionChanged = true;
        return next;
      }

      next[cardId] = record;
      return next;
    }, {});

    state.booklets = Object.values(state.booklets).reduce((next, booklet) => {
      const nextCardIds = booklet.cardIds.filter((cardId) => state.cardById.has(cardId) && state.collection[cardId]);
      if (nextCardIds.length !== booklet.cardIds.length) {
        bookletsChanged = true;
      }

      next[booklet.id] = {
        ...booklet,
        cardIds: nextCardIds
      };
      return next;
    }, {});

    const activeBookletChanged = ensureActiveBookletId();

    if (collectionChanged) {
      saveCollectionState();
    }
    if (bookletsChanged) {
      saveBookletsState();
    }
    if (activeBookletChanged) {
      saveProgressState();
    }
  }

  function clearRevealTimer() {
    if (state.revealPreviewTimerId) {
      window.clearTimeout(state.revealPreviewTimerId);
      state.revealPreviewTimerId = null;
    }

    if (state.revealDropTimerId) {
      window.clearTimeout(state.revealDropTimerId);
      state.revealDropTimerId = null;
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) {
      return "Unavailable";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2
    }).format(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCompare(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeRarity(card) {
    const rarity = String(card.rarity || "").toLowerCase();

    if (rarity.includes("uncommon")) {
      return "uncommon";
    }

    if (rarity.includes("common")) {
      return "common";
    }

    if (!rarity.trim()) {
      return "common";
    }

    return "rare";
  }

  function getRarityText(card) {
    return card.rarity || normalizeRarity(card);
  }

  function getCardRevealScore(card) {
    const rarityText = String(card.rarity || "").toLowerCase();
    let score = rarityText.includes("common") ? 10 : rarityText.includes("uncommon") ? 35 : 70;

    [
      ["promo", 4],
      ["holo", 12],
      ["prism", 18],
      ["shiny", 22],
      ["radiant", 26],
      ["gx", 28],
      ["ex", 26],
      ["vmax", 34],
      ["vstar", 34],
      ["secret", 38],
      ["ultra", 34],
      ["full art", 36],
      ["illustration", 42],
      ["hyper", 44]
    ].forEach(([keyword, boost]) => {
      if (rarityText.includes(keyword)) {
        score += boost;
      }
    });

    return score;
  }

  function parseReleaseTime(releaseDate) {
    if (!releaseDate) {
      return 0;
    }

    const normalizedDate = String(releaseDate).replace(/\//g, "-");
    const time = new Date(normalizedDate).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function compareCardNumbers(left, right) {
    const leftNumber = Number.parseInt(left.number, 10);
    const rightNumber = Number.parseInt(right.number, 10);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return String(left.number || "").localeCompare(String(right.number || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function getPackFeatureCard(cards) {
    return [...cards]
      .filter((card) => card.images?.large || card.images?.small)
      .sort((left, right) => {
        const scoreDelta = getCardRevealScore(right) - getCardRevealScore(left);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return compareCardNumbers(left, right);
      })[0] || cards[0] || null;
  }

  function buildPackCatalog() {
    const groupedSets = new Map();

    state.cards.forEach((card) => {
      const setId = card.set?.id;
      if (!setId) {
        return;
      }

      if (!groupedSets.has(setId)) {
        groupedSets.set(setId, {
          id: setId,
          name: card.set?.name || "Unknown Pack",
          series: card.set?.series || "Pokemon",
          releaseDate: card.set?.releaseDate || "",
          printedTotal: card.set?.printedTotal || card.set?.total || 0,
          logoUrl: card.set?.images?.logo || "",
          symbolUrl: card.set?.images?.symbol || "",
          isRandom: false,
          cards: []
        });
      }

      groupedSets.get(setId).cards.push(card);
    });

    const setPacks = [...groupedSets.values()]
      .map((pack) => {
        const cards = [...pack.cards].sort(compareCardNumbers);
        const featureCard = getPackFeatureCard(cards);

        return {
          ...pack,
          cards,
          cardCount: cards.length,
          artUrl: featureCard?.images?.large || featureCard?.images?.small || "",
          featureCardName: featureCard?.name || ""
        };
      })
      .sort((left, right) => {
        const releaseDelta = parseReleaseTime(right.releaseDate) - parseReleaseTime(left.releaseDate);
        if (releaseDelta !== 0) {
          return releaseDelta;
        }

        return left.name.localeCompare(right.name);
      });

    const randomPack = {
      id: RANDOM_PACK_ID,
      name: "Random",
      series: "All Sets",
      releaseDate: "",
      printedTotal: state.cards.length,
      logoUrl: "",
      symbolUrl: "",
      isRandom: true,
      cards: state.cards,
      cardCount: state.cards.length,
      artUrl: "",
      featureCardName: "Anything can happen"
    };

    state.packs = [randomPack, ...setPacks];
    state.packById = new Map(state.packs.map((pack) => [pack.id, pack]));

    if (!state.packById.has(state.selectedPackId)) {
      state.selectedPackId = RANDOM_PACK_ID;
      saveProgressState();
    }
  }

  function getSelectedPack() {
    return state.packById.get(state.selectedPackId) || state.packById.get(RANDOM_PACK_ID) || null;
  }

  function getPackSearchText(pack) {
    return [
      pack.name,
      pack.series,
      pack.releaseDate,
      pack.featureCardName
    ].join(" ");
  }

  function getVisiblePacks() {
    const query = normalizeCompare(state.packSearch);
    if (!query) {
      return state.packs;
    }

    return state.packs.filter((pack) => normalizeCompare(getPackSearchText(pack)).includes(query));
  }

  function getPriceCacheEntry(cardId) {
    return state.priceCache[cardId] || null;
  }

  function isTimestampFresh(timestamp) {
    return Boolean(
      timestamp &&
      Date.now() - new Date(timestamp).getTime() < PRICE_CACHE_TTL_MS
    );
  }

  function isRawPriceFresh(cacheEntry) {
    return Boolean(
      cacheEntry &&
      (cacheEntry.raw || cacheEntry.marketStatus) &&
      isTimestampFresh(cacheEntry.rawUpdatedAt)
    );
  }

  function extractLocalUngradedPrice(card) {
    const candidates = [];
    const tcgplayerPrices = card?.tcgplayer?.prices;

    if (tcgplayerPrices && typeof tcgplayerPrices === "object") {
      const orderedKeys = [
        "normal",
        "holofoil",
        "reverseHolofoil",
        "1stEditionNormal",
        "1stEditionHolofoil",
        "unlimitedNormal",
        "unlimitedHolofoil"
      ];
      const seen = new Set();
      const keys = [...orderedKeys, ...Object.keys(tcgplayerPrices)];

      keys.forEach((key) => {
        if (seen.has(key) || !tcgplayerPrices[key]) {
          return;
        }

        seen.add(key);
        const tier = tcgplayerPrices[key];
        const value = [tier.market, tier.mid, tier.high, tier.low, tier.directLow]
          .find((candidate) => Number.isFinite(candidate));

        if (Number.isFinite(value)) {
          candidates.push({
            source: `TCGplayer ${key}`,
            value,
            score: orderedKeys.includes(key) ? orderedKeys.length - orderedKeys.indexOf(key) : 0
          });
        }
      });
    }

    const cardmarketPrices = card?.cardmarket?.prices;
    if (cardmarketPrices && typeof cardmarketPrices === "object") {
      const value = [
        cardmarketPrices.averageSellPrice,
        cardmarketPrices.trendPrice,
        cardmarketPrices.lowPriceExPlus,
        cardmarketPrices.lowPrice
      ].find((candidate) => Number.isFinite(candidate));

      if (Number.isFinite(value)) {
        candidates.push({
          source: "Cardmarket",
          value,
          score: 1
        });
      }
    }

    candidates.sort((left, right) => right.score - left.score || right.value - left.value);
    return candidates[0] || null;
  }

  async function fetchRawPriceData(card) {
    const url = new URL(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(card.id)}`);
    url.searchParams.set("select", "id,tcgplayer,cardmarket");

    const response = await fetch(url.toString());

    if (response.status === 404) {
      return { marketStatus: "not_found", raw: null, rawUpdatedAt: new Date().toISOString() };
    }
    if (response.status === 429) {
      return { marketStatus: "rate_limited", raw: null, rawUpdatedAt: new Date().toISOString() };
    }
    if (!response.ok) {
      return { marketStatus: "error", raw: null, rawUpdatedAt: new Date().toISOString() };
    }

    const payload = await response.json();
    const remoteCard = payload?.data
      ? {
          ...card,
          tcgplayer: payload.data.tcgplayer,
          cardmarket: payload.data.cardmarket
        }
      : null;

    const raw = remoteCard ? extractLocalUngradedPrice(remoteCard) : null;
    if (!raw) {
      return { marketStatus: "no_prices", raw: null, rawUpdatedAt: new Date().toISOString() };
    }

    return {
      marketStatus: "ok",
      raw,
      rawUpdatedAt: new Date().toISOString()
    };
  }

  function saveRawPriceResult(cardId, result) {
    const current = getPriceCacheEntry(cardId);
    state.priceCache[cardId] = {
      ...(current || {}),
      ...result
    };
    savePriceCacheState();
  }

  function queueRawPriceLookup(cardId, force = false, options = {}) {
    const { skipRender = false } = options;
    const card = state.cardById.get(cardId);
    const current = getPriceCacheEntry(cardId);

    if (!card) {
      return;
    }

    const localPrice = extractLocalUngradedPrice(card);
    if (!force && localPrice && Number.isFinite(localPrice.value)) {
      return;
    }

    if (!force && current && isRawPriceFresh(current)) {
      return;
    }

    if (state.rawPriceQueue.includes(cardId)) {
      return;
    }

    state.rawPriceQueue.push(cardId);
    saveRawPriceResult(cardId, {
      marketStatus: "loading",
      rawUpdatedAt: new Date().toISOString()
    });

    if (!skipRender && !isPackRevealActive()) {
      renderAll();
    }

    void processRawPriceQueue();
  }

  function queueSavedCollectionRawPrices(force = false) {
    Object.keys(state.collection).forEach((cardId) => queueRawPriceLookup(cardId, force));
  }

  function queueBookletPrices(bookletId, force = false) {
    getBookletEntries(bookletId).forEach(({ card }) => queueRawPriceLookup(card.id, force, { skipRender: true }));
  }

  async function processRawPriceQueue() {
    if (state.rawPriceLookupInFlight || !state.rawPriceQueue.length) {
      return;
    }

    state.rawPriceLookupInFlight = true;

    while (state.rawPriceQueue.length) {
      const cardId = state.rawPriceQueue.shift();
      const card = state.cardById.get(cardId);

      if (card) {
        try {
          saveRawPriceResult(cardId, await fetchRawPriceData(card));
        }
        catch {
          saveRawPriceResult(cardId, {
            marketStatus: "error",
            raw: null,
            rawUpdatedAt: new Date().toISOString()
          });
        }

        if (!isPackRevealActive()) {
          renderAll();
        }
      }
    }

    state.rawPriceLookupInFlight = false;
  }

  function getRawPriceNumericValue(cardId) {
    const entry = getPriceCacheEntry(cardId);
    if (entry?.raw && Number.isFinite(entry.raw.value)) {
      return Number(entry.raw.value);
    }

    const localPrice = extractLocalUngradedPrice(state.cardById.get(cardId));
    return localPrice && Number.isFinite(localPrice.value) ? Number(localPrice.value) : Number.NaN;
  }

  function getRawPriceLabel(cardId) {
    const liveEntry = getPriceCacheEntry(cardId);
    if (liveEntry?.raw && Number.isFinite(liveEntry.raw.value)) {
      return `Price: ${formatCurrency(liveEntry.raw.value)}`;
    }

    const localPrice = extractLocalUngradedPrice(state.cardById.get(cardId));
    if (localPrice && Number.isFinite(localPrice.value)) {
      return `Price: ${formatCurrency(localPrice.value)}`;
    }

    if (liveEntry?.marketStatus === "loading" || state.rawPriceQueue.includes(cardId)) {
      return "Price: loading";
    }

    switch (liveEntry?.marketStatus) {
      case "rate_limited":
        return "Price: try later";
      case "not_found":
      case "no_prices":
        return "Price: no data";
      case "error":
        return "Price: unavailable";
      default:
        return "Price: loading";
    }
  }

  function getCompactPriceLabel(label) {
    return label
      .replace("Price: ", "")
      .replace("unavailable", "--")
      .replace("loading", "...")
      .replace("try later", "wait")
      .replace("no data", "none");
  }

  function renderPriceMarkup(cardId, className, compact = false) {
    const label = compact ? getCompactPriceLabel(getRawPriceLabel(cardId)) : getRawPriceLabel(cardId);

    return `
      <div class="${className}">
        <span class="price-pill">${escapeHtml(label)}</span>
      </div>
    `;
  }

  async function getPackSortValue(card) {
    const existingValue = getRawPriceNumericValue(card.id);
    if (Number.isFinite(existingValue)) {
      return existingValue;
    }

    try {
      const result = await fetchRawPriceData(card);
      saveRawPriceResult(card.id, result);
      return result?.raw && Number.isFinite(result.raw.value)
        ? Number(result.raw.value)
        : Number.NaN;
    }
    catch {
      saveRawPriceResult(card.id, {
        marketStatus: "error",
        raw: null,
        rawUpdatedAt: new Date().toISOString()
      });
      return Number.NaN;
    }
  }

  function pickRandomCards(cardPool) {
    const availableCards = Array.isArray(cardPool) ? cardPool.filter(Boolean) : [];
    const pickedIndices = new Set();
    const picks = [];

    while (picks.length < PACK_SIZE && pickedIndices.size < availableCards.length) {
      const randomIndex = Math.floor(Math.random() * availableCards.length);
      if (!pickedIndices.has(randomIndex)) {
        pickedIndices.add(randomIndex);
        picks.push(availableCards[randomIndex]);
      }
    }

    while (picks.length < PACK_SIZE && availableCards.length) {
      picks.push(availableCards[Math.floor(Math.random() * availableCards.length)]);
    }

    return picks;
  }

  async function drawCardsFromPool(cardPool) {
    const picks = pickRandomCards(cardPool);

    const orderedCards = await Promise.all(
      picks.map(async (card, order) => {
        const fallbackValue = getCardRevealScore(card) / 10;
        const liveValue = await getPackSortValue(card);

        return {
          card,
          order,
          fallbackValue,
          sortValue: Number.isFinite(liveValue) ? liveValue : fallbackValue
        };
      })
    );

    return orderedCards
      .sort((left, right) => left.sortValue - right.sortValue || left.fallbackValue - right.fallbackValue || left.order - right.order)
      .map((entry) => entry.card);
  }

  async function drawPackCards(pack) {
    return drawCardsFromPool(pack?.cards || state.cards);
  }

  function triggerPackIntro() {
    elements.packScreen.classList.remove("is-opening");
  }

  function isPackRevealActive() {
    return Boolean(
      state.currentView === "pack" &&
      state.currentPack &&
      (state.currentPack.phase === "preview" || state.currentPack.phase === "animating")
    );
  }

  function setView(viewName) {
    state.currentView = viewName;
    if (viewName !== "collection") {
      state.zoomedCardId = null;
    }

    elements.menuScreen.classList.toggle("is-active", viewName === "menu");
    elements.packsScreen.classList.toggle("is-active", viewName === "packs");
    elements.packScreen.classList.toggle("is-active", viewName === "pack");
    elements.collectionScreen.classList.toggle("is-active", viewName === "collection");

    if (viewName === "collection") {
      queueSavedCollectionRawPrices(false);
    }

    if (viewName === "menu" && state.activeBookletId) {
      queueBookletPrices(state.activeBookletId, false);
    }
  }

  async function createNewPack(packId = state.selectedPackId) {
    const sourcePack = state.packById.get(packId) || getSelectedPack();
    if (!sourcePack || !sourcePack.cards.length || state.packBuildInFlight) {
      return;
    }

    clearRevealTimer();
    state.packBuildInFlight = true;
    state.selectedPackId = sourcePack.id;
    state.currentPack = null;
    saveProgressState();
    renderAll();

    let cards = [];

    try {
      cards = await drawPackCards(sourcePack);
    }
    finally {
      state.packBuildInFlight = false;
    }

    if (!cards.length) {
      renderAll();
      return;
    }

    state.packsOpened += 1;
    saveProgressState();

    state.currentPack = {
      sourcePackId: sourcePack.id,
      packMeta: sourcePack,
      cards,
      activeIndex: 0,
      revealedCount: 0,
      phase: "sealed",
      animatingCard: null
    };

    state.currentPack.cards.forEach((card) => queueRawPriceLookup(card.id, false, { skipRender: true }));

    setView("pack");
    renderAll();
    triggerPackIntro();
  }

  function returnToPacks() {
    clearRevealTimer();
    state.currentPack = null;
    setView("packs");
    renderAll();
  }

  function openAnotherCurrentPack() {
    const sourcePackId = state.currentPack?.sourcePackId || state.selectedPackId;
    void createNewPack(sourcePackId);
  }

  function startPackCut() {
    if (!state.currentPack || state.currentPack.phase !== "sealed") {
      return;
    }

    state.currentPack.phase = "cut";
    renderPackScreen();

    state.revealPreviewTimerId = window.setTimeout(() => {
      if (!state.currentPack || state.currentPack.phase !== "cut") {
        return;
      }

      state.currentPack.phase = "ready";
      state.revealPreviewTimerId = null;
      renderPackScreen();
    }, PACK_CUT_MS);
  }

  function ensureCollectionRecord(cardId) {
    if (!state.collection[cardId]) {
      const now = new Date().toISOString();
      state.collection[cardId] = {
        count: 0,
        favorite: false,
        firstSavedAt: now,
        savedAt: now
      };
    }

    return state.collection[cardId];
  }

  function addCardToCollection(card) {
    const record = ensureCollectionRecord(card.id);
    record.count += 1;
    record.savedAt = new Date().toISOString();
    saveCollectionState();
    queueRawPriceLookup(card.id, false, { skipRender: true });
  }

  function toggleFavoriteCollectionCard(cardId) {
    const record = ensureCollectionRecord(cardId);
    record.favorite = !record.favorite;
    saveCollectionState();
    renderAll();
  }

  function clearCollection() {
    if (!Object.keys(state.collection).length) {
      return;
    }

    if (!window.confirm("Clear every card from your collection? This also empties the cards inside your booklets.")) {
      return;
    }

    state.collection = {};
    state.booklets = Object.values(state.booklets).reduce((next, booklet) => {
      next[booklet.id] = {
        ...booklet,
        cardIds: []
      };
      return next;
    }, {});
    state.zoomedCardId = null;

    saveCollectionState();
    saveBookletsState();
    renderAll();
  }

  function generateBookletId() {
    return `booklet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function createBooklet(name, initialCardId) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      return null;
    }

    const now = new Date().toISOString();
    const booklet = {
      id: generateBookletId(),
      name: trimmedName,
      cardIds: initialCardId ? [initialCardId] : [],
      createdAt: now,
      updatedAt: now
    };

    state.booklets[booklet.id] = booklet;
    state.activeBookletId = booklet.id;
    saveBookletsState();
    saveProgressState();

    if (initialCardId) {
      queueRawPriceLookup(initialCardId, false, { skipRender: true });
    }

    return booklet;
  }

  function toggleCardInBooklet(bookletId, cardId) {
    const booklet = state.booklets[bookletId];
    if (!booklet) {
      return false;
    }

    if (booklet.cardIds.includes(cardId)) {
      booklet.cardIds = booklet.cardIds.filter((savedCardId) => savedCardId !== cardId);
    }
    else {
      booklet.cardIds = [...booklet.cardIds, cardId];
    }

    booklet.updatedAt = new Date().toISOString();
    state.activeBookletId = booklet.id;
    saveBookletsState();
    saveProgressState();
    queueRawPriceLookup(cardId, false, { skipRender: true });
    return booklet.cardIds.includes(cardId);
  }

  function getCollectionEntries() {
    return Object.entries(state.collection)
      .map(([cardId, record]) => {
        const card = state.cardById.get(cardId);
        if (!card) {
          return null;
        }

        return { card, record };
      })
      .filter(Boolean);
  }

  function getCardBooklets(cardId) {
    return getBookletsArray().filter((booklet) => booklet.cardIds.includes(cardId));
  }

  function getBookletEntries(bookletId) {
    const booklet = state.booklets[bookletId];
    if (!booklet) {
      return [];
    }

    return booklet.cardIds
      .map((cardId) => {
        const card = state.cardById.get(cardId);
        const record = state.collection[cardId];
        if (!card || !record) {
          return null;
        }

        return { card, record };
      })
      .filter(Boolean);
  }

  function matchesCollectionSearch(card) {
    const query = normalizeCompare(state.collectionSearch);
    if (!query) {
      return true;
    }

    return [
      card.name,
      card.number,
      card.set?.name || "",
      getRarityText(card)
    ].some((value) => normalizeCompare(value).includes(query));
  }

  function getPrimaryBookletName(cardId) {
    const [booklet] = getCardBooklets(cardId);
    return booklet?.name || "zzzz No Booklet";
  }

  function compareCollectionEntries(left, right) {
    if (state.collectionSort === "favorites" && left.record.favorite !== right.record.favorite) {
      return Number(right.record.favorite) - Number(left.record.favorite);
    }

    if (state.collectionSort === "booklet") {
      const bookletDelta = getPrimaryBookletName(left.card.id).localeCompare(getPrimaryBookletName(right.card.id));
      if (bookletDelta !== 0) {
        return bookletDelta;
      }
    }

    const leftPrice = getRawPriceNumericValue(left.card.id);
    const rightPrice = getRawPriceNumericValue(right.card.id);
    const leftHasPrice = Number.isFinite(leftPrice);
    const rightHasPrice = Number.isFinite(rightPrice);

    if ((state.collectionSort === "price-asc" || state.collectionSort === "price-desc") && leftHasPrice && rightHasPrice && leftPrice !== rightPrice) {
      return state.collectionSort === "price-asc"
        ? leftPrice - rightPrice
        : rightPrice - leftPrice;
    }

    if ((state.collectionSort === "price-asc" || state.collectionSort === "price-desc") && leftHasPrice !== rightHasPrice) {
      return leftHasPrice ? -1 : 1;
    }

    if (left.record.favorite !== right.record.favorite) {
      return Number(right.record.favorite) - Number(left.record.favorite);
    }

    const nameDelta = left.card.name.localeCompare(right.card.name);
    if (nameDelta !== 0) {
      return nameDelta;
    }

    return new Date(right.record.savedAt).getTime() - new Date(left.record.savedAt).getTime();
  }

  function getFilteredCollectionEntries() {
    return getCollectionEntries()
      .filter((entry) => state.collectionFilter === "favorites" ? entry.record.favorite : true)
      .filter((entry) => matchesCollectionSearch(entry.card))
      .sort(compareCollectionEntries);
  }

  function getCollectionSummary() {
    return getCollectionEntries().reduce((summary, entry) => {
      summary.uniqueSaved += 1;
      summary.savedCards += entry.record.count;
      summary.favoriteCount += entry.record.favorite ? 1 : 0;
      return summary;
    }, {
      uniqueSaved: 0,
      savedCards: 0,
      favoriteCount: 0,
      bookletCount: getBookletsArray().length
    });
  }

  function finalizeCurrentPackReveal() {
    if (!state.currentPack || !state.currentPack.animatingCard) {
      return;
    }

    const card = state.currentPack.animatingCard;
    clearRevealTimer();
    addCardToCollection(card);
    state.currentPack.revealedCount += 1;
    state.currentPack.activeIndex += 1;
    state.currentPack.animatingCard = null;
    state.currentPack.phase = state.currentPack.revealedCount >= state.currentPack.cards.length
      ? "summary"
      : "ready";
    renderAll();
  }

  function startPackReveal() {
    if (!state.currentPack || state.currentPack.phase !== "ready") {
      return;
    }

    const card = state.currentPack.cards[state.currentPack.activeIndex];
    if (!card) {
      return;
    }

    state.currentPack.phase = "preview";
    state.currentPack.animatingCard = card;
    renderPackScreen();

    state.revealPreviewTimerId = window.setTimeout(() => {
      if (!state.currentPack) {
        return;
      }

      state.currentPack.phase = "animating";
      state.revealPreviewTimerId = null;
      renderPackScreen();

      state.revealDropTimerId = window.setTimeout(() => {
        finalizeCurrentPackReveal();
        state.revealDropTimerId = null;
      }, REVEAL_DROP_MS);
    }, REVEAL_PREVIEW_MS);
  }

  function handlePackStageClick() {
    if (!state.currentPack) {
      return;
    }

    if (state.currentPack.phase === "sealed") {
      startPackCut();
      return;
    }

    if (state.currentPack.phase === "cut") {
      return;
    }

    if (state.currentPack.phase === "ready") {
      startPackReveal();
      return;
    }

    if (state.currentPack.phase === "preview" || state.currentPack.phase === "animating") {
      finalizeCurrentPackReveal();
    }
  }

  function autoRevealPack() {
    function revealNext() {
      if (!state.currentPack || state.currentPack.phase === "summary") {
        return;
      }

      if (state.currentPack.phase === "sealed") {
        startPackCut();
        window.setTimeout(revealNext, PACK_CUT_MS + 90);
        return;
      }

      if (state.currentPack.phase === "ready") {
        startPackReveal();
        window.setTimeout(revealNext, REVEAL_PREVIEW_MS + REVEAL_DROP_MS + 90);
      }
    }

    window.setTimeout(revealNext, 120);
  }

  function renderMenuBooklets() {
    const booklets = getBookletsArray();
    let title = "Your Cards";
    let entries = [];

    if (booklets.length) {
      const activeChanged = ensureActiveBookletId();
      if (activeChanged) {
        saveProgressState();
      }

      const activeBooklet = state.booklets[state.activeBookletId];
      if (activeBooklet) {
        title = activeBooklet.name;
        queueBookletPrices(activeBooklet.id, false);
        entries = getBookletEntries(activeBooklet.id);
      }
    }
    else {
      entries = getCollectionEntries()
        .sort(() => Math.random() - 0.5)
        .slice(0, 36);
    }

    elements.bookletActiveName.textContent = title;

    if (!entries.length) {
      elements.bookletPreview.innerHTML = `
        <div class="booklet-empty">
          <strong>${booklets.length ? "This booklet is empty." : "No cards yet."}</strong>
          <p>${booklets.length ? "Open a collection card and add it to this booklet." : "Open packs and your pulled cards will auto-scroll here."}</p>
        </div>
      `;
      return;
    }

    const scrollEntries = entries.length < 8
      ? [...entries, ...entries, ...entries]
      : [...entries, ...entries];

    elements.bookletPreview.innerHTML = `
      <div class="booklet-preview-track is-auto-scroll">
        ${scrollEntries.map(({ card, record }) => `
          <button
            class="booklet-preview-card"
            type="button"
            data-action="open-booklet-card"
            data-card-id="${escapeHtml(card.id)}"
          >
            <img src="${escapeHtml(card.images?.small || "")}" alt="${escapeHtml(card.name)}">
            <div class="booklet-preview-copy">
              <h4>${escapeHtml(card.name)}</h4>
              <p>Owned x${formatNumber(record.count)}</p>
              ${renderPriceMarkup(card.id, "booklet-preview-prices", true)}
            </div>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderPackArtwork(pack, sizeClass = "") {
    if (!pack) {
      return "";
    }

    if (pack.isRandom) {
      return `
        <div class="pack-art-shell is-random-pack ${sizeClass}">
          <div class="pack-art-random">
            <strong>Random</strong>
            <span>Pack</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="pack-art-shell ${sizeClass}">
        <div class="pack-art-crimp top"></div>
        <div class="pack-art-crimp bottom"></div>
        ${pack.artUrl ? `<img class="pack-art-feature" src="${escapeHtml(pack.artUrl)}" alt="${escapeHtml(pack.featureCardName || pack.name)}">` : ""}
        <div class="pack-art-glow"></div>
        ${pack.logoUrl ? `<img class="pack-art-logo" src="${escapeHtml(pack.logoUrl)}" alt="${escapeHtml(pack.name)} logo">` : `<strong class="pack-art-fallback-name">${escapeHtml(pack.name)}</strong>`}
      </div>
    `;
  }

  function renderPackListItem(pack) {
    const isActive = pack.id === state.selectedPackId;

    return `
      <button
        class="pack-choice ${isActive ? "is-active" : ""}"
        type="button"
        data-action="select-pack"
        data-pack-id="${escapeHtml(pack.id)}"
      >
        ${renderPackArtwork(pack)}
        <span class="pack-choice-copy">
          <strong>${escapeHtml(pack.name)}</strong>
          <span>${escapeHtml(pack.series)} | ${formatNumber(pack.cardCount)} cards</span>
        </span>
      </button>
    `;
  }

  function getPackDetailCards(pack) {
    if (!pack) {
      return [];
    }

    if (!pack.isRandom) {
      return pack.cards;
    }

    return [...pack.cards]
      .sort(() => Math.random() - 0.5)
      .slice(0, PACK_DETAIL_RANDOM_SAMPLE_SIZE);
  }

  function renderPackCardPreview(card) {
    return `
      <button
        class="pack-card-preview"
        type="button"
        data-action="preview-pack-card"
        data-card-id="${escapeHtml(card.id)}"
      >
        <img src="${escapeHtml(card.images?.small || "")}" alt="${escapeHtml(card.name)}">
        <span>${escapeHtml(card.name)}</span>
      </button>
    `;
  }

  function renderPackDetail() {
    const pack = getSelectedPack();

    if (!pack) {
      elements.packDetail.innerHTML = `
        <div class="empty-state">
          <div>
            <strong>No pack selected.</strong>
            <p>Choose a pack to see the cards inside it.</p>
          </div>
        </div>
      `;
      return;
    }

    const previewCards = getPackDetailCards(pack);
    const releaseText = pack.releaseDate ? `Released ${pack.releaseDate}` : "Full catalog";

    elements.packDetail.innerHTML = `
      <div class="pack-detail-hero">
        ${renderPackArtwork(pack, "is-large")}
        <div class="pack-detail-copy">
          <p class="eyebrow">${escapeHtml(pack.series)}</p>
          <h2>${escapeHtml(pack.name)}</h2>
          <p>${escapeHtml(releaseText)} | ${formatNumber(pack.cardCount)} card${pack.cardCount === 1 ? "" : "s"} in the pool.</p>
          <button class="primary-button big-button" type="button" data-action="open-selected-pack" data-pack-id="${escapeHtml(pack.id)}" ${state.packBuildInFlight ? "disabled" : ""}>${state.packBuildInFlight ? "Building Pack..." : "Open Pack"}</button>
        </div>
      </div>
      <div class="pack-card-section">
        <div class="pack-card-section-header">
          <h3>Cards In Pack</h3>
          <p>${pack.isRandom ? `Showing ${formatNumber(previewCards.length)} random examples from every card.` : `Showing all ${formatNumber(previewCards.length)} cards from this pack.`}</p>
        </div>
        <div class="pack-card-grid">
          ${previewCards.map((card) => renderPackCardPreview(card)).join("")}
        </div>
      </div>
    `;
  }

  function renderPacksView() {
    const visiblePacks = getVisiblePacks();

    elements.packsSearchInput.value = state.packSearch;
    elements.packsGrid.innerHTML = visiblePacks.length
      ? visiblePacks.map((pack) => renderPackListItem(pack)).join("")
      : `
        <div class="empty-state">
          <div>
            <strong>No packs match that search.</strong>
            <p>Try a set name, series, or featured Pokemon.</p>
          </div>
        </div>
      `;

    renderPackDetail();
  }

  function renderMenu() {
    elements.openPackButton.disabled = state.packBuildInFlight;
    elements.openCollectionButton.disabled = state.packBuildInFlight;
    elements.openPackButton.textContent = state.packBuildInFlight ? "Building Pack..." : "Packs";
    renderMenuBooklets();
  }

  function renderSealedPack(pack, phase) {
    const phaseClass = phase === "cut" ? "is-cutting" : "is-entering";

    return `
      <div class="sealed-pack ${pack?.isRandom ? "is-random-pack" : ""} ${phaseClass}">
        <div class="sealed-pack-top">
          <div class="sealed-pack-crimp"></div>
        </div>
        <div class="sealed-pack-body">
          ${renderPackArtwork(pack || getSelectedPack(), "is-sealed")}
        </div>
      </div>
    `;
  }

  function renderPackStageCard(card) {
    if (!card) {
      return renderPackBack(1, "Open a new pack from the pack page.");
    }

    return `
      <div class="pack-reveal-card">
        <img src="${escapeHtml(card.images?.large || card.images?.small || "")}" alt="${escapeHtml(card.name)}">
        <div class="pack-reveal-overlay">
          <strong>${escapeHtml(card.name)}</strong>
          ${renderPriceMarkup(card.id, "pack-reveal-prices")}
        </div>
      </div>
    `;
  }

  function renderPackBack(slotNumber, message = "Click the card back to reveal it.") {
    const packName = state.currentPack?.packMeta?.name || "Pack";

    return `
      <div class="pack-back">
        <img class="pack-back-art" src="${escapeHtml(POKEMON_CARD_BACK_URL)}" alt="Pokemon card back">
        <div class="pack-back-copy">
          <div>
            <span>${escapeHtml(packName)}</span>
            <strong>Card ${slotNumber}</strong>
            <p>${escapeHtml(message)}</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderPackSummaryCard(card) {
    return `
      <article class="tray-card">
        <div class="tray-card-shell">
          <img src="${escapeHtml(card.images?.small || "")}" alt="${escapeHtml(card.name)}">
          <div class="tray-card-meta">
            <div>
              <h3>${escapeHtml(card.name)}</h3>
            </div>
            <div class="price-stack">
              <span class="price-pill">${escapeHtml(getRawPriceLabel(card.id))}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderPackTrayCard(card) {
    return `
      <article class="tray-card">
        <div class="tray-card-shell">
          <img src="${escapeHtml(card.images?.small || "")}" alt="${escapeHtml(card.name)}">
          ${renderPriceMarkup(card.id, "tray-price-badges", true)}
        </div>
      </article>
    `;
  }

  function renderPackScreen() {
    const pack = state.currentPack;

    if (!pack) {
      elements.packProgress.textContent = `0 / ${PACK_SIZE}`;
      elements.packInstruction.textContent = state.packBuildInFlight
        ? "Building your pack..."
        : "Choose a pack from the pack page to start.";
      elements.packStage.classList.remove("is-hidden", "is-previewing", "is-dropping");
      elements.packSummaryHeading.classList.remove("is-visible");
      elements.packSummaryHeading.innerHTML = "";
      elements.packStageContent.innerHTML = renderPackBack(1, state.packBuildInFlight ? "Shuffling real cards from this pack." : "Choose a pack from the pack page.");
      elements.revealedTray.classList.remove("is-summary");
      elements.revealedTray.innerHTML = "";
      elements.packSummaryActions.classList.remove("is-visible");
      return;
    }

    const currentSlot = Math.min(pack.activeIndex + (pack.phase === "summary" ? 0 : 1), pack.cards.length);
    elements.packProgress.textContent = `${Math.min(pack.revealedCount, pack.cards.length)} / ${pack.cards.length}`;

    if (pack.phase === "sealed" || pack.phase === "cut") {
      elements.packInstruction.textContent = pack.phase === "sealed"
        ? "Click the pack to cut the very top open."
        : "Cutting the top open...";
      elements.packStage.classList.remove("is-hidden", "is-previewing", "is-dropping");
      elements.packSummaryHeading.classList.remove("is-visible");
      elements.packSummaryHeading.innerHTML = "";
      elements.packStageContent.innerHTML = renderSealedPack(pack.packMeta, pack.phase);
      elements.revealedTray.classList.remove("is-summary");
      elements.revealedTray.innerHTML = "";
      elements.packSummaryActions.classList.remove("is-visible");
      return;
    }

    if (pack.phase === "summary") {
      elements.packInstruction.textContent = "Every card from this pack is now in your collection.";
      elements.packStage.classList.add("is-hidden");
      elements.packStage.classList.remove("is-previewing", "is-dropping");
      elements.packSummaryHeading.classList.add("is-visible");
      elements.packSummaryHeading.innerHTML = `
        <h2>Pack Complete</h2>
        <p>Cheapest cards led the pack, and the most expensive pull waited at the back.</p>
      `;
      elements.revealedTray.classList.add("is-summary");
      elements.revealedTray.innerHTML = pack.cards.map((card) => renderPackSummaryCard(card)).join("");
      elements.packSummaryActions.classList.add("is-visible");
      return;
    }

    elements.packSummaryHeading.classList.remove("is-visible");
    elements.packSummaryHeading.innerHTML = "";
    elements.revealedTray.classList.remove("is-summary");
    elements.revealedTray.innerHTML = pack.cards
      .slice(0, pack.revealedCount)
      .map((card) => renderPackTrayCard(card))
      .join("");
    elements.packSummaryActions.classList.remove("is-visible");

    if (pack.phase === "preview" && pack.animatingCard) {
      elements.packInstruction.textContent = `${pack.animatingCard.name} is up. Take a second to look at it before it drops down.`;
      elements.packStage.classList.remove("is-hidden", "is-dropping");
      elements.packStage.classList.add("is-previewing");
      elements.packStageContent.innerHTML = renderPackStageCard(pack.animatingCard);
      return;
    }

    if (pack.phase === "animating" && pack.animatingCard) {
      elements.packInstruction.textContent = `${pack.animatingCard.name} is dropping into your pack line.`;
      elements.packStage.classList.remove("is-hidden");
      elements.packStage.classList.remove("is-previewing");
      elements.packStage.classList.add("is-dropping");
      elements.packStageContent.innerHTML = renderPackStageCard(pack.animatingCard);
      return;
    }

    elements.packInstruction.textContent = `Card ${currentSlot} is ready. Click the Pokemon card back to reveal it.`;
    elements.packStage.classList.remove("is-hidden", "is-previewing", "is-dropping");
    elements.packStageContent.innerHTML = renderPackBack(currentSlot, "Cheapest cards start the pack. Biggest card waits at the back.");
  }

  function openCardZoom(cardId) {
    const card = state.cardById.get(cardId);
    if (!card) {
      return;
    }

    state.zoomedCardId = cardId;
    queueRawPriceLookup(cardId, false, { skipRender: true });
    renderAll();
  }

  function closeCardZoom() {
    if (!state.zoomedCardId) {
      return;
    }

    state.zoomedCardId = null;
    renderAll();
  }

  function renderCardZoom() {
    const card = state.zoomedCardId ? state.cardById.get(state.zoomedCardId) : null;
    const record = state.zoomedCardId ? state.collection[state.zoomedCardId] : null;

    elements.cardZoomModal.classList.toggle("is-open", Boolean(card));
    elements.cardZoomModal.setAttribute("aria-hidden", String(!card));

    if (!card) {
      elements.cardZoomContent.innerHTML = "";
      return;
    }

    const cardBooklets = getCardBooklets(card.id);
    const booklets = getBookletsArray();

    elements.cardZoomContent.innerHTML = `
      <article class="card-zoom-panel">
        <div class="card-zoom-art">
          <img src="${escapeHtml(card.images?.large || card.images?.small || "")}" alt="${escapeHtml(card.name)}">
        </div>
        <div class="card-zoom-copy">
          <p class="eyebrow">Collection Card</p>
          <h3>${escapeHtml(card.name)}</h3>
          <p class="card-zoom-line">${escapeHtml(card.set?.name || "Unknown set")} | #${escapeHtml(card.number || "?")} | ${escapeHtml(getRarityText(card))}</p>
          <div class="price-stack">
            <span class="price-pill">${escapeHtml(getRawPriceLabel(card.id))}</span>
          </div>
          <div class="card-zoom-meta">
            <span class="price-pill">Owned x${formatNumber(record?.count || 0)}</span>
            <button class="favorite-toggle ${record?.favorite ? "is-on" : ""}" type="button" data-action="toggle-favorite" data-card-id="${escapeHtml(card.id)}">${record?.favorite ? "&#9733; Starred" : "&#9734; Star"}</button>
          </div>
          <div class="booklet-manager">
            <div class="booklet-manager-header">
              <div>
                <h4>Booklets</h4>
                <p class="card-zoom-note">${cardBooklets.length ? `In ${cardBooklets.length} booklet${cardBooklets.length === 1 ? "" : "s"}.` : "Not in a booklet yet."}</p>
              </div>
              <button class="secondary-button" type="button" data-action="create-booklet" data-card-id="${escapeHtml(card.id)}">Create Booklet</button>
            </div>
            ${booklets.length
              ? `
                <div class="booklet-chip-list">
                  ${booklets.map((booklet) => {
                    const isInside = booklet.cardIds.includes(card.id);
                    return `
                      <button
                        class="booklet-chip ${isInside ? "is-on" : ""}"
                        type="button"
                        data-action="toggle-booklet"
                        data-booklet-id="${escapeHtml(booklet.id)}"
                        data-card-id="${escapeHtml(card.id)}"
                      >
                        ${escapeHtml(isInside ? `Remove from ${booklet.name}` : `Add to ${booklet.name}`)}
                      </button>
                    `;
                  }).join("")}
                </div>
              `
              : `<p class="card-zoom-note">Create your first booklet here and this card will be added to it right away.</p>`}
          </div>
        </div>
      </article>
    `;
  }

  function getCollectionEmptyState() {
    if (state.collectionSearch.trim()) {
      return {
        title: "No cards match that search.",
        copy: "Try a different Pokemon name, card number, or set name."
      };
    }

    if (state.collectionFilter === "favorites") {
      return {
        title: "No starred cards yet.",
        copy: "Open packs and star the cards you want to keep easy to find."
      };
    }

    return {
      title: "No cards pulled yet.",
      copy: "Open a random pack from the menu and your pulls will appear here automatically."
    };
  }

  function renderCollectionView() {
    const summary = getCollectionSummary();
    const entries = getFilteredCollectionEntries();

    elements.collectionPacksOpenedCount.textContent = formatNumber(state.packsOpened);
    elements.collectionSavedCount.textContent = formatNumber(summary.savedCards);
    elements.collectionFavoriteCount.textContent = formatNumber(summary.favoriteCount);
    elements.collectionBookletCount.textContent = formatNumber(summary.bookletCount);
    elements.allFilterButton.classList.toggle("is-active", state.collectionFilter === "all");
    elements.favoritesFilterButton.classList.toggle("is-active", state.collectionFilter === "favorites");
    elements.collectionSearchInput.value = state.collectionSearch;
    elements.collectionSortSelect.value = state.collectionSort;
    elements.pricingStatus.textContent = summary.uniqueSaved
      ? `Showing ${formatNumber(entries.length)} of ${formatNumber(summary.uniqueSaved)} unique cards. Prices load automatically when available.`
      : "Open a pack and your collection will show up here.";

    if (!entries.length) {
      const emptyState = getCollectionEmptyState();
      elements.collectionGrid.innerHTML = `
        <div class="empty-state">
          <div>
            <strong>${escapeHtml(emptyState.title)}</strong>
            <p>${escapeHtml(emptyState.copy)}</p>
          </div>
        </div>
      `;
      return;
    }

    elements.collectionGrid.innerHTML = entries.map(({ card, record }) => {
      const cardBooklets = getCardBooklets(card.id);
      const bookletLabel = cardBooklets.length
        ? `In ${cardBooklets.length} booklet${cardBooklets.length === 1 ? "" : "s"}`
        : "No booklet yet";

      return `
        <article class="collection-card" data-card-id="${escapeHtml(card.id)}" tabindex="0">
          <div class="collection-card-art">
            <img src="${escapeHtml(card.images?.small || "")}" alt="${escapeHtml(card.name)}">
            <span class="copy-badge">x${formatNumber(record.count)}</span>
          </div>
          <div class="collection-card-copy">
            <div>
              <h3>${escapeHtml(card.name)}</h3>
              <div class="collection-card-line">${escapeHtml(card.set?.name || "Unknown set")} | #${escapeHtml(card.number || "?")} | ${escapeHtml(getRarityText(card))}</div>
            </div>
            <div class="price-stack">
              <span class="price-pill">${escapeHtml(getRawPriceLabel(card.id))}</span>
            </div>
          </div>
          <div class="collection-card-actions">
            <button class="favorite-toggle ${record.favorite ? "is-on" : ""}" type="button" data-action="toggle-favorite" data-card-id="${escapeHtml(card.id)}">${record.favorite ? "&#9733; Starred" : "&#9734; Star"}</button>
            <span class="collection-card-note">${escapeHtml(bookletLabel)}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderAll() {
    renderMenu();
    renderPacksView();
    renderPackScreen();
    renderCollectionView();
    renderCardZoom();
  }

  function handleCreateBooklet(cardId) {
    const response = window.prompt("Name this booklet:");
    if (response === null) {
      return;
    }

    const trimmedName = response.trim();
    if (!trimmedName) {
      window.alert("Please give the booklet a name.");
      return;
    }

    createBooklet(trimmedName, cardId);
    renderAll();
  }

  function bindEvents() {
    elements.openPackButton.addEventListener("click", () => {
      setView("packs");
      renderAll();
    });

    elements.openCollectionButton.addEventListener("click", () => {
      setView("collection");
      renderAll();
    });

    elements.packsBackButton.addEventListener("click", () => {
      setView("menu");
      renderAll();
    });

    elements.packsSearchInput.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      state.packSearch = target.value;
      renderPacksView();
    });

    elements.collectionBackButton.addEventListener("click", () => {
      setView("menu");
      renderAll();
    });

    elements.packsGrid.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("[data-action='select-pack']");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const packId = button.getAttribute("data-pack-id");
      if (!packId || !state.packById.has(packId)) {
        return;
      }

      state.selectedPackId = packId;
      saveProgressState();
      renderPacksView();
    });

    elements.packDetail.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("[data-action]");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const action = button.getAttribute("data-action");
      if (action === "open-selected-pack") {
        const packId = button.getAttribute("data-pack-id") || state.selectedPackId;
        void createNewPack(packId);
        return;
      }

      if (action === "preview-pack-card") {
        const cardId = button.getAttribute("data-card-id");
        if (cardId) {
          openCardZoom(cardId);
        }
      }
    });

    elements.bookletPreview.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("[data-action='open-booklet-card']");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const cardId = button.getAttribute("data-card-id");
      if (!cardId) {
        return;
      }

      setView("collection");
      openCardZoom(cardId);
    });

    elements.packStage.addEventListener("click", handlePackStageClick);
    elements.packOpenAnotherButton.addEventListener("click", openAnotherCurrentPack);
    elements.packBackToPacksButton.addEventListener("click", returnToPacks);
    elements.cardZoomBackdrop.addEventListener("click", closeCardZoom);
    elements.cardZoomClose.addEventListener("click", closeCardZoom);

    elements.allFilterButton.addEventListener("click", () => {
      state.collectionFilter = "all";
      renderCollectionView();
    });

    elements.favoritesFilterButton.addEventListener("click", () => {
      state.collectionFilter = "favorites";
      renderCollectionView();
    });

    elements.collectionSearchInput.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      state.collectionSearch = target.value;
      renderCollectionView();
    });

    elements.collectionSortSelect.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }

      state.collectionSort = ["price-desc", "price-asc", "favorites", "booklet"].includes(target.value)
        ? target.value
        : "price-desc";
      renderCollectionView();
    });

    elements.refreshPricesButton.addEventListener("click", () => {
      queueSavedCollectionRawPrices(true);
      if (state.activeBookletId) {
        queueBookletPrices(state.activeBookletId, true);
      }
      renderAll();
    });

    elements.clearCollectionButton.addEventListener("click", clearCollection);

    elements.collectionGrid.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("[data-action]");
      if (button instanceof HTMLElement) {
        const action = button.getAttribute("data-action");
        const cardId = button.getAttribute("data-card-id");
        if (action === "toggle-favorite" && cardId) {
          toggleFavoriteCollectionCard(cardId);
          return;
        }
      }

      const card = target.closest(".collection-card");
      if (card instanceof HTMLElement) {
        const clickedCardId = card.getAttribute("data-card-id");
        if (clickedCardId) {
          openCardZoom(clickedCardId);
        }
      }
    });

    elements.collectionGrid.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest("[data-action]")) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const card = target.closest(".collection-card");
      if (!(card instanceof HTMLElement)) {
        return;
      }

      const cardId = card.getAttribute("data-card-id");
      if (cardId) {
        event.preventDefault();
        openCardZoom(cardId);
      }
    });

    elements.cardZoomContent.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("[data-action]");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const action = button.getAttribute("data-action");
      const cardId = button.getAttribute("data-card-id");

      if (action === "toggle-favorite" && cardId) {
        toggleFavoriteCollectionCard(cardId);
        return;
      }

      if (action === "create-booklet" && cardId) {
        handleCreateBooklet(cardId);
        return;
      }

      if (action === "toggle-booklet" && cardId) {
        const bookletId = button.getAttribute("data-booklet-id");
        if (!bookletId) {
          return;
        }

        toggleCardInBooklet(bookletId, cardId);
        renderAll();
      }
    });

    elements.packFadeOverlay.addEventListener("animationend", () => {
      elements.packScreen.classList.remove("is-opening");
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCardZoom();
      }
    });
  }

  function boot() {
    if (!dataBundle || !Array.isArray(dataBundle.cards) || !dataBundle.cards.length) {
      elements.pricingStatus.textContent = "Collection is unavailable until card data is loaded.";
      elements.bookletActiveName.textContent = "Missing Catalog";
      elements.bookletPreview.innerHTML = `
        <div class="booklet-empty">
          <strong>Missing catalog</strong>
          <p>Run the downloader script so the simulator can load cards before building booklets.</p>
        </div>
      `;
      elements.collectionGrid.innerHTML = `
        <div class="empty-state">
          <div>
            <strong>Missing catalog</strong>
            <p>Run the downloader script so the simulator can load cards.</p>
          </div>
        </div>
      `;
      elements.packsGrid.innerHTML = `
        <div class="empty-state">
          <div>
            <strong>Missing catalog</strong>
            <p>Run the downloader script so the pack page can load.</p>
          </div>
        </div>
      `;
      elements.packDetail.innerHTML = "";
      elements.packInstruction.textContent = "Card data is missing.";
      elements.packStageContent.innerHTML = renderPackBack(1, "Card data is missing.");
      elements.openPackButton.disabled = true;
      elements.openCollectionButton.disabled = true;
      elements.packStage.disabled = true;
      elements.packOpenAnotherButton.disabled = true;
      elements.packBackToPacksButton.disabled = true;
      elements.packsSearchInput.disabled = true;
      elements.collectionSearchInput.disabled = true;
      elements.collectionSortSelect.disabled = true;
      elements.refreshPricesButton.disabled = true;
      elements.clearCollectionButton.disabled = true;
      return;
    }

    loadStoredState();
    state.cards = dataBundle.cards.filter((card) => card.images?.small && card.set?.name);
    state.cardById = new Map(state.cards.map((card) => [card.id, card]));
    buildPackCatalog();
    sanitizeStoredStateAgainstCatalog();

    bindEvents();

    const startup = getStartupConfig();
    if (startup.openPack || startup.view === "pack") {
      void createNewPack().then(() => {
        if (startup.revealAll) {
          autoRevealPack();
        }
      });
      return;
    }

    if (startup.view === "collection") {
      setView("collection");
    }

    if (startup.view === "packs") {
      setView("packs");
    }

    renderAll();
  }

  boot();
})();
