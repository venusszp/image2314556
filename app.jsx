import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

const initialViewer = {
  open: false,
  index: -1,
  scale: 1,
  baseFitScale: 1,
  minScale: 1,
  maxScale: 8,
  offsetX: 0,
  offsetY: 0,
  naturalWidth: 0,
  naturalHeight: 0,
};

const initialVideoPlayer = {
  playing: true,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  zoom: 1,
  advanced: false,
};

function App() {
  const [media, setMedia] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState({ open: false, mode: "create", folderId: null });
  const [folderName, setFolderName] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pickerShowAll, setPickerShowAll] = useState(false);
  const [viewer, setViewer] = useState(initialViewer);
  const [imageRotation, setImageRotation] = useState(0);
  const [videoPlayer, setVideoPlayer] = useState(initialVideoPlayer);
  const [toast, setToast] = useState(null);
  const [showcaseItems, setShowcaseItems] = useState([]);
  const [showcaseIndex, setShowcaseIndex] = useState(0);

  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const videoRef = useRef(null);
  const pointersRef = useRef(new Map());
  const dragRef = useRef({ active: false, x: 0, y: 0, pinchStartDistance: 0, pinchStartScale: 1, pinchStartOffsetX: 0, pinchStartOffsetY: 0 });

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!viewer.open) return undefined;
    const onResize = () => fitCurrentImage();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [viewer.open, viewer.index]);

  useEffect(() => {
    document.body.classList.toggle("viewer-open", viewer.open);
    return () => document.body.classList.remove("viewer-open");
  }, [viewer.open]);

  useEffect(() => {
    const onKey = (event) => {
      if (modal.open && event.key === "Escape") {
        closeModal();
      }
      if (viewer.open) {
        if (event.key === "Escape") closeViewer();
        if (event.key === "ArrowRight") stepViewer(1);
        if (event.key === "ArrowLeft") stepViewer(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal.open, viewer.open]);

  async function loadAll() {
    const [mediaResponse, stateResponse] = await Promise.all([
      fetch("/api/media", { cache: "no-store" }),
      fetch("/api/state", { cache: "no-store" }),
    ]);

    const mediaData = await mediaResponse.json();
    const stateData = await stateResponse.json();
    setMedia(Array.isArray(mediaData.items) ? mediaData.items : []);
    setFolders(Array.isArray(stateData.folders) ? stateData.folders : []);
    setToast({ title: "Готово", text: `Найдено ${Array.isArray(mediaData.items) ? mediaData.items.length : 0} файлов.` });
  }

  async function persistFolders(nextFolders) {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folders: nextFolders }),
    });
    const savedState = await response.json();
    setFolders(Array.isArray(savedState.folders) ? savedState.folders : nextFolders);
  }

  const sortedFolders = useMemo(() => {
    return folders
      .slice()
      .sort((a, b) => b.itemIds.length - a.itemIds.length || a.name.localeCompare(b.name, "ru"));
  }, [folders]);

  const visibleItems = useMemo(() => {
    let items = media.slice();

    if (selectedFolderId !== "all") {
      const folder = folders.find((item) => item.id === selectedFolderId);
      const ids = new Set(folder ? folder.itemIds : []);
      items = items.filter((item) => ids.has(item.id));
    }

    if (view === "assigned") {
      const ids = new Set(folders.flatMap((folder) => folder.itemIds));
      items = items.filter((item) => ids.has(item.id));
    }

    if (view === "unassigned") {
      const ids = new Set(folders.flatMap((folder) => folder.itemIds));
      items = items.filter((item) => !ids.has(item.id));
    }

    if (view === "image") items = items.filter((item) => item.kind === "image");
    if (view === "video") items = items.filter((item) => item.kind === "video");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((item) => (
        item.name.toLowerCase().includes(q)
        || item.relativePath.toLowerCase().includes(q)
        || String(item.id).includes(q)
      ));
    }

    return items.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, "ru"));
  }, [folders, media, search, selectedFolderId, view]);

  const currentItem = viewer.index >= 0 ? visibleItems[viewer.index] : null;
  const showcaseSourceImages = useMemo(() => {
    const currentFolder = folders.find((entry) => entry.id === selectedFolderId);
    const sourceItems = selectedFolderId === "all"
      ? media
      : media.filter((item) => currentFolder ? currentFolder.itemIds.includes(item.id) : false);
    return sourceItems.filter((item) => item.kind === "image");
  }, [folders, media, selectedFolderId]);
  const activeShowcaseItem = showcaseItems[showcaseIndex] || null;

  useEffect(() => {
    setVideoPlayer((prev) => ({ ...initialVideoPlayer, advanced: prev.advanced }));
    setImageRotation(0);
  }, [currentItem?.id]);

  useEffect(() => {
    if (showcaseItems.length < 2) return undefined;
    const id = window.setInterval(() => {
      setShowcaseIndex((prev) => {
        const nextIndex = (prev + 1) % showcaseItems.length;
        if (nextIndex === 0) {
          setShowcaseItems(pickRandomItems(showcaseSourceImages, 6));
        }
        return nextIndex;
      });
    }, 4200);
    return () => window.clearInterval(id);
  }, [showcaseItems, showcaseSourceImages]);

  useEffect(() => {
    setShowcaseItems(pickRandomItems(showcaseSourceImages, 6));
    setShowcaseIndex(0);
  }, [showcaseSourceImages]);

  function getItemFolderNames(itemId, ignoredFolderId = null) {
    return folders
      .filter((folder) => folder.id !== ignoredFolderId && folder.itemIds.includes(itemId))
      .map((folder) => folder.name);
  }

  const pickerItems = useMemo(() => {
    const currentFolderId = modal.mode === "edit" ? modal.folderId : null;
    return media
      .filter((item) => {
        const owners = getItemFolderNames(item.id, currentFolderId);
        return pickerShowAll || owners.length === 0 || selectedIds.has(item.id);
      })
      .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, "ru"));
  }, [media, folders, modal.mode, modal.folderId, pickerShowAll, selectedIds]);

  function openCreateModal() {
    setModal({ open: true, mode: "create", folderId: null });
    setFolderName("");
    setSelectedIds(new Set());
    setPickerShowAll(false);
  }

  function openEditModal() {
    if (selectedFolderId === "all") {
      setToast({ title: "Сначала выбери папку", text: "Нужно выбрать одну из созданных папок слева." });
      return;
    }
    const folder = folders.find((item) => item.id === selectedFolderId);
    if (!folder) return;
    setModal({ open: true, mode: "edit", folderId: folder.id });
    setFolderName(folder.name);
    setSelectedIds(new Set(folder.itemIds));
    setPickerShowAll(false);
  }

  function closeModal() {
    setModal({ open: false, mode: "create", folderId: null });
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name) {
      setToast({ title: "Нужно название", text: "Введи имя папки." });
      return;
    }

    const itemIds = Array.from(selectedIds);
    let nextFolders;

    if (modal.mode === "edit" && modal.folderId) {
      nextFolders = folders.map((folder) => (
        folder.id === modal.folderId ? { ...folder, name, itemIds } : folder
      ));
    } else {
      nextFolders = [{ id: `folder-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name, itemIds }, ...folders];
    }

    await persistFolders(nextFolders);
    closeModal();
    setToast({ title: "Сохранено", text: `Папка "${name}" обновлена.` });
  }

  async function deleteCurrentFolder() {
    if (selectedFolderId === "all") {
      setToast({ title: "Нельзя удалить", text: "Папка 'Все media' системная." });
      return;
    }
    const folder = folders.find((item) => item.id === selectedFolderId);
    if (!folder) return;
    const nextFolders = folders.filter((item) => item.id !== folder.id);
    setSelectedFolderId("all");
    await persistFolders(nextFolders);
    setToast({ title: "Удалено", text: `Папка "${folder.name}" удалена.` });
  }

  function toggleItemSelection(itemId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function openViewer(index) {
    setViewer({ ...initialViewer, open: true, index });
  }

  function openShowcaseItem(itemId) {
    const folder = folders.find((entry) => entry.id === selectedFolderId);
    const baseItems = media
      .filter((item) => {
        if (selectedFolderId === "all") return true;
        return folder ? folder.itemIds.includes(item.id) : false;
      })
      .filter((item) => item.kind === "image" || item.kind === "video")
      .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, "ru"));

    const index = baseItems.findIndex((item) => item.id === itemId);
    if (index < 0) return;

    setView("all");
    setSearch("");
    setViewer({ ...initialViewer, open: true, index });
  }

  function closeViewer() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    pointersRef.current.clear();
    dragRef.current = { active: false, x: 0, y: 0, pinchStartDistance: 0, pinchStartScale: 1, pinchStartOffsetX: 0, pinchStartOffsetY: 0 };
    setImageRotation(0);
    setVideoPlayer(initialVideoPlayer);
    setViewer(initialViewer);
  }

  function stepViewer(direction) {
    if (!visibleItems.length) return;
    setViewer((prev) => ({ ...initialViewer, open: true, index: (prev.index + direction + visibleItems.length) % visibleItems.length }));
  }

  function onImageLoad() {
    if (!imageRef.current) return;
    setViewer((prev) => ({
      ...prev,
      naturalWidth: imageRef.current.naturalWidth || 0,
      naturalHeight: imageRef.current.naturalHeight || 0,
    }));
    requestAnimationFrame(fitCurrentImage);
  }

  function fitCurrentImage() {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !currentItem || currentItem.kind !== "image") return;
    const maxWidth = Math.max(80, stage.clientWidth - 60);
    const maxHeight = Math.max(80, stage.clientHeight - 60);
    const widthRatio = maxWidth / (image.naturalWidth || 1);
    const heightRatio = maxHeight / (image.naturalHeight || 1);
    const fitScale = Math.min(widthRatio, heightRatio, 1);
    setViewer((prev) => clampViewerState({
      ...prev,
      scale: fitScale,
      baseFitScale: fitScale,
      minScale: fitScale,
      offsetX: 0,
      offsetY: 0,
    }, stage, image.naturalWidth || 1, image.naturalHeight || 1));
  }

  function applyZoom(nextScale, centerX = 0, centerY = 0) {
    if (!currentItem || currentItem.kind !== "image") return;
    setViewer((prev) => {
      const stage = stageRef.current;
      const image = imageRef.current;
      if (!stage || !image) return prev;
      const clamped = Math.min(prev.maxScale, Math.max(prev.minScale, nextScale));
      const dx = centerX - stage.clientWidth / 2;
      const dy = centerY - stage.clientHeight / 2;
      const ratio = prev.scale ? clamped / prev.scale : 1;
      return clampViewerState({
        ...prev,
        scale: clamped,
        offsetX: dx - (dx - prev.offsetX) * ratio,
        offsetY: dy - (dy - prev.offsetY) * ratio,
      }, stage, image.naturalWidth || prev.naturalWidth || 1, image.naturalHeight || prev.naturalHeight || 1);
    });
  }

  function onStageDoubleClick(event) {
    if (!currentItem || currentItem.kind !== "image") return;
    const rect = stageRef.current.getBoundingClientRect();
    const scale = viewer.scale > viewer.baseFitScale * 1.4 ? viewer.baseFitScale : Math.min(viewer.baseFitScale * 2.5, viewer.maxScale);
    applyZoom(scale, event.clientX - rect.left, event.clientY - rect.top);
  }

  function onStageWheel(event) {
    if (!currentItem || currentItem.kind !== "image") return;
    event.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    const multiplier = event.deltaY < 0 ? 1.12 : 0.88;
    applyZoom(viewer.scale * multiplier, event.clientX - rect.left, event.clientY - rect.top);
  }

  function onPointerDown(event) {
    if (!currentItem || currentItem.kind !== "image") return;
    stageRef.current.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current.active = true;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
    }
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      dragRef.current.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      dragRef.current.pinchStartScale = viewer.scale;
      dragRef.current.pinchStartOffsetX = viewer.offsetX;
      dragRef.current.pinchStartOffsetY = viewer.offsetY;
    }
  }

  function onPointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1 && dragRef.current.active && viewer.scale > viewer.baseFitScale) {
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
      setViewer((prev) => {
        const stage = stageRef.current;
        const image = imageRef.current;
        if (!stage || !image) return prev;
        return clampViewerState({
          ...prev,
          offsetX: prev.offsetX + dx,
          offsetY: prev.offsetY + dy,
        }, stage, image.naturalWidth || prev.naturalWidth || 1, image.naturalHeight || prev.naturalHeight || 1);
      });
    }

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const rect = stageRef.current.getBoundingClientRect();
      const centerX = ((a.x + b.x) / 2) - rect.left;
      const centerY = ((a.y + b.y) / 2) - rect.top;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / Math.max(dragRef.current.pinchStartDistance, 1);
      setViewer((prev) => {
        const stage = stageRef.current;
        const image = imageRef.current;
        if (!stage || !image) return prev;
        return clampViewerState({
          ...prev,
          offsetX: dragRef.current.pinchStartOffsetX,
          offsetY: dragRef.current.pinchStartOffsetY,
        }, stage, image.naturalWidth || prev.naturalWidth || 1, image.naturalHeight || prev.naturalHeight || 1);
      });
      applyZoom(dragRef.current.pinchStartScale * ratio, centerX, centerY);
    }
  }

  function onPointerUp(event) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) dragRef.current.active = false;
    if (pointersRef.current.size < 2) dragRef.current.pinchStartDistance = 0;
  }

  async function downloadCurrent() {
    if (!currentItem) return;
    const link = document.createElement("a");
    link.href = currentItem.url;
    link.download = currentItem.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function syncVideoPlayer() {
    if (!videoRef.current) return;
    const element = videoRef.current;
    setVideoPlayer((prev) => ({
      ...prev,
      playing: !element.paused,
      currentTime: Number.isFinite(element.currentTime) ? element.currentTime : 0,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      playbackRate: element.playbackRate || prev.playbackRate,
    }));
  }

  function toggleVideoPlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play();
    else videoRef.current.pause();
    syncVideoPlayer();
  }

  function setVideoPlaybackRate(rate) {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    syncVideoPlayer();
  }

  function setVideoZoom(zoom) {
    setVideoPlayer((prev) => ({
      ...prev,
      zoom: Math.min(4, Math.max(1, zoom)),
    }));
  }

  function seekVideo(time) {
    if (!videoRef.current) return;
    const duration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
    const nextTime = Math.min(duration || 0, Math.max(0, time));
    videoRef.current.currentTime = nextTime;
    syncVideoPlayer();
  }

  function nudgeVideo(milliseconds) {
    seekVideo((videoRef.current?.currentTime || 0) + (milliseconds / 1000));
  }

  const imageTransform = `translate(calc(-50% + ${viewer.offsetX}px), calc(-50% + ${viewer.offsetY}px)) rotate(${imageRotation}deg) scale(${viewer.scale})`;

  return html`
    <div className="app">
      <aside className="panel sidebar">
        <section className="brand">
          <h1>Media<br />Vault</h1>
          <p>React-фронт и сохранение папок на бэкенде. Привязка файлов хранится по стабильному id: относительный путь файла внутри папки <code>images</code>.</p>
        </section>

        <section>
          <h2 className="section-title">Папки</h2>
          <div className="actions" style=${{ marginBottom: "12px" }}>
            <button className="btn primary" onClick=${openCreateModal}>Создать папку</button>
            <button className="btn" onClick=${openEditModal}>Редактировать</button>
            <button className="btn danger" onClick=${deleteCurrentFolder}>Удалить</button>
          </div>
          <div className="folder-list">
            <button className=${`folder-btn ${selectedFolderId === "all" ? "active" : ""}`} onClick=${() => setSelectedFolderId("all")}>
              <span className="folder-name">Все media</span>
              <span className="folder-count">${media.length}</span>
            </button>
            ${sortedFolders.map((folder) => html`
              <button key=${folder.id} className=${`folder-btn ${selectedFolderId === folder.id ? "active" : ""}`} onClick=${() => setSelectedFolderId(folder.id)}>
                <span className="folder-name">${folder.name}</span>
                <span className="folder-count">${folder.itemIds.length}</span>
              </button>
            `)}
          </div>
        </section>
      </aside>

      <main className="main">
        <section className="panel hero">
          <div>
            <h2>React + backend сохранение</h2>
            <p>Файлы читаются из папки <code>images</code>, а папки и связи между ними сохраняются на бэкенде в JSON. Даже после перезапуска сервера структура останется.</p>
          </div>
          <div className="actions">
            <button className="btn primary" onClick=${loadAll}>Обновить media</button>
          </div>
        </section>

        <section className="panel showcase">
          <div className="showcase-copy">
            <span className="section-title">Давайте посмотрим</span>
            <h2>Случайные фото сверху</h2>
            <p>Витрина берёт рандомные кадры из текущей папки и красиво перелистывает их автоматически.</p>
          </div>
          ${activeShowcaseItem
            ? html`
                <div className="showcase-stage">
                  <button
                    className="showcase-main"
                    onClick=${() => openShowcaseItem(activeShowcaseItem.id)}
                  >
                    <img
                      key=${activeShowcaseItem.id}
                      className="showcase-image"
                      src=${activeShowcaseItem.url}
                      alt=${activeShowcaseItem.name}
                    />
                    <div className="showcase-overlay">
                      <span className="showcase-pill">ID ${activeShowcaseItem.id}</span>
                      <strong>${activeShowcaseItem.name}</strong>
                    </div>
                  </button>
                  <div className="showcase-strip">
                    ${showcaseItems.map((item, index) => html`
                      <button
                        key=${item.id}
                        className=${`showcase-thumb ${index === showcaseIndex ? "active" : ""}`}
                        onClick=${() => setShowcaseIndex(index)}
                      >
                        <img src=${item.url} alt=${item.name} />
                      </button>
                    `)}
                  </div>
                </div>
              `
            : html`<div className="empty">В текущей папке пока нет фото для верхней витрины.</div>`}
        </section>

        <section className="panel gallery-panel">
          <div className="chips">
            ${["all", "assigned", "unassigned", "image", "video"].map((kind) => html`
              <button
                key=${kind}
                className=${`chip ${view === kind ? "active" : ""}`}
                onClick=${() => setView(kind)}
              >
                ${kind === "all" ? "Все" : kind === "assigned" ? "Только в папках" : kind === "unassigned" ? "Без папки" : kind === "image" ? "Только фото" : "Только видео"}
              </button>
            `)}
          </div>
          <input className="search" value=${search} onInput=${(event) => setSearch(event.target.value)} placeholder="Поиск по имени файла..." />
          ${visibleItems.length === 0
            ? html`<div className="empty">В папке <code>images</code> пока ничего не найдено или текущий фильтр пустой.</div>`
            : html`
                <div className="gallery">
                  ${visibleItems.map((item, index) => {
                    const folderNames = folders.filter((folder) => folder.itemIds.includes(item.id)).map((folder) => folder.name).join(", ") || "Без папки";
                    return html`
                      <article key=${item.id} className="tile">
                        <button className="tile-button" onClick=${() => openViewer(index)}>
                          <div className="thumb">
                            ${item.kind === "image"
                              ? html`<img src=${item.url} alt=${item.name} loading="lazy" />`
                              : html`<video src=${item.url} muted preload="metadata"></video>`}
                            <span className="badge">${item.kind === "image" ? "Фото" : "Видео"}</span>
                          </div>
                          <div className="tile-info">
                            <span className="tile-title">${item.name}</span>
                            <span className="tile-sub">ID: ${item.id}</span>
                            <span className="tile-sub">${folderNames}</span>
                          </div>
                        </button>
                      </article>
                    `;
                  })}
                </div>
              `}
        </section>
      </main>

      <aside className="panel rightbar">
        <section>
          <h2 className="section-title">Статистика</h2>
          <div className="meta-list">
            <div className="meta-card">
              <span className="meta-label">Всего файлов</span>
              <div className="meta-title">${media.length}</div>
            </div>
            <div className="meta-card">
              <span className="meta-label">В текущем виде</span>
              <div className="meta-title">${visibleItems.length}</div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="section-title">Текущая папка</h2>
          <div className="meta-list">
            <div className="meta-card">
              <span className="meta-label">Название</span>
              <div className="meta-value">${selectedFolderId === "all" ? "Все media" : (folders.find((item) => item.id === selectedFolderId)?.name || "Все media")}</div>
            </div>
            <div className="meta-card">
              <span className="meta-label">Сохранение</span>
              <div className="meta-value">JSON на сервере, media ID = 1..1000</div>
            </div>
          </div>
        </section>
      </aside>

      <div className=${`modal ${modal.open ? "open" : ""}`} onClick=${(event) => event.target === event.currentTarget && closeModal()}>
        <div className="modal-card">
          <h3>${modal.mode === "edit" ? "Редактировать папку" : "Создать папку"}</h3>
          <p>${modal.mode === "edit" ? "Переименуй папку и измени состав файлов." : "Введи название и отметь, какие файлы должны лежать в этой папке."}</p>
          <label className="modal-label">Название</label>
          <input className="modal-input" value=${folderName} onInput=${(event) => setFolderName(event.target.value)} placeholder="Например: Лучшее, Видео, Личное" />
          <div className="picker-toolbar">
            <label className="toggle-line">
              <input type="checkbox" checked=${pickerShowAll} onChange=${(event) => setPickerShowAll(event.target.checked)} />
              <span>Показывать файлы из других папок</span>
            </label>
            <span className="picker-summary">Выбрано: ${selectedIds.size} • видно: ${pickerItems.length}</span>
          </div>
          <div className="picker-grid">
            ${pickerItems.map((item) => {
              const owners = getItemFolderNames(item.id, modal.mode === "edit" ? modal.folderId : null);
              const selected = selectedIds.has(item.id);
              return html`
                <div
                  key=${item.id}
                  className=${`pick-card ${selected ? "selected" : ""} ${owners.length > 0 && !selected ? "locked" : ""}`}
                  onClick=${() => toggleItemSelection(item.id)}
                  onDragStart=${(event) => event.preventDefault()}
                >
                  ${item.kind === "image"
                    ? html`<img src=${item.url} alt=${item.name} loading="lazy" draggable="false" />`
                    : html`<video src=${item.url} muted preload="metadata" draggable="false"></video>`}
                  <span className="pick-check">✓</span>
                  <span className="pick-card-name">${item.name}</span>
                  <span className="pick-card-meta">${owners.length ? `Уже в: ${owners.join(", ")}` : "Свободно"}</span>
                </div>
              `;
            })}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick=${closeModal}>Отмена</button>
            <button className="btn primary" onClick=${saveFolder}>Сохранить</button>
          </div>
        </div>
      </div>

      <div className=${`viewer ${viewer.open ? "open" : ""}`} onClick=${(event) => event.target === event.currentTarget && closeViewer()}>
        <div className="viewer-card">
          <div className="viewer-top">
            <div className="viewer-title">
              <strong>${currentItem?.name || "Файл"}</strong>
              <span>${currentItem ? `${currentItem.kind === "image" ? "Фото" : "Видео"} • ${formatBytes(currentItem.size)}` : ""}</span>
            </div>
            <div className="viewer-actions">
              <button className="btn" onClick=${() => applyZoom(viewer.scale / 1.2)} disabled=${!currentItem || currentItem.kind !== "image"}>-</button>
              <button className="btn" onClick=${fitCurrentImage} disabled=${!currentItem || currentItem.kind !== "image"}>100%</button>
              <button className="btn" onClick=${() => applyZoom(viewer.scale * 1.2)} disabled=${!currentItem || currentItem.kind !== "image"}>+</button>
              <button className="btn" onClick=${() => setImageRotation((prev) => (prev + 90) % 360)} disabled=${!currentItem || currentItem.kind !== "image"}>↻ 90°</button>
              <button className="btn" onClick=${toggleVideoPlayback} disabled=${!currentItem || currentItem.kind !== "video"}>${videoPlayer.playing ? "Пауза" : "Пуск"}</button>
              <button className="btn" onClick=${() => setVideoZoom(videoPlayer.zoom - 0.2)} disabled=${!currentItem || currentItem.kind !== "video"}>Видео -</button>
              <button className="btn" onClick=${() => setVideoZoom(1)} disabled=${!currentItem || currentItem.kind !== "video"}>Видео 100%</button>
              <button className="btn" onClick=${() => setVideoZoom(videoPlayer.zoom + 0.2)} disabled=${!currentItem || currentItem.kind !== "video"}>Видео +</button>
              <button className="btn" onClick=${downloadCurrent}>Скачать</button>
              <button className="btn warm" onClick=${closeViewer}>Закрыть</button>
            </div>
          </div>
          <div
            ref=${stageRef}
            className="viewer-stage"
            onDblClick=${onStageDoubleClick}
            onWheel=${onStageWheel}
            onPointerDown=${onPointerDown}
            onPointerMove=${onPointerMove}
            onPointerUp=${onPointerUp}
            onPointerCancel=${onPointerUp}
            onPointerLeave=${onPointerUp}
          >
            ${currentItem?.kind === "image"
              ? html`<img ref=${imageRef} src=${currentItem.url} alt=${currentItem.name} style=${{ transform: imageTransform }} onLoad=${onImageLoad} />`
              : currentItem
                ? html`
                    <div className="video-shell">
                      <video
                        ref=${videoRef}
                        src=${currentItem.url}
                        playsInline
                        autoPlay
                        preload="metadata"
                        style=${{ transform: `translate(-50%, -50%) scale(${videoPlayer.zoom})` }}
                        onLoadedMetadata=${syncVideoPlayer}
                        onTimeUpdate=${syncVideoPlayer}
                        onPlay=${syncVideoPlayer}
                        onPause=${syncVideoPlayer}
                        onRateChange=${syncVideoPlayer}
                      ></video>
                    </div>
                  `
                : null}
          </div>
          <div className="viewer-bottom">
            ${currentItem?.kind === "video" ? html`
              <div className="video-controls">
                <div className="viewer-nav">
                  <button className="btn" onClick=${() => setVideoPlaybackRate(0.25)}>0.25x</button>
                  <button className="btn" onClick=${() => setVideoPlaybackRate(0.5)}>0.5x</button>
                  <button className="btn" onClick=${() => setVideoPlaybackRate(1)}>1x</button>
                  <button className="btn" onClick=${() => setVideoPlaybackRate(1.5)}>1.5x</button>
                  <button className="btn" onClick=${() => setVideoPlaybackRate(2)}>2x</button>
                  <button className=${`btn ${videoPlayer.advanced ? "primary" : ""}`} onClick=${() => setVideoPlayer((prev) => ({ ...prev, advanced: !prev.advanced }))}>Точный режим</button>
                </div>
                <div className="video-timeline">
                  <span>${formatVideoTime(videoPlayer.currentTime, videoPlayer.advanced)}</span>
                  <input
                    className="timeline-slider"
                    type="range"
                    min="0"
                    max=${videoPlayer.duration || 0}
                    step=${videoPlayer.advanced ? "0.001" : "0.05"}
                    value=${Math.min(videoPlayer.currentTime, videoPlayer.duration || 0)}
                    onInput=${(event) => seekVideo(Number(event.target.value))}
                  />
                  <span>${formatVideoTime(videoPlayer.duration, videoPlayer.advanced)}</span>
                </div>
                <div className="viewer-nav">
                  ${videoPlayer.advanced ? html`
                    <button className="btn" onClick=${() => nudgeVideo(-100)}>-100мс</button>
                    <button className="btn" onClick=${() => nudgeVideo(-10)}>-10мс</button>
                    <button className="btn" onClick=${() => nudgeVideo(-1)}>-1мс</button>
                    <button className="btn" onClick=${() => nudgeVideo(1)}>+1мс</button>
                    <button className="btn" onClick=${() => nudgeVideo(10)}>+10мс</button>
                    <button className="btn" onClick=${() => nudgeVideo(100)}>+100мс</button>
                  ` : null}
                  <span className="video-meta">Скорость ${videoPlayer.playbackRate.toFixed(2)}x • Zoom ${videoPlayer.zoom.toFixed(1)}x</span>
                </div>
              </div>
            ` : null}
            <div className="viewer-nav">
              <button className="btn" onClick=${() => stepViewer(-1)}>Предыдущее</button>
              <button className="btn" onClick=${() => stepViewer(1)}>Следующее</button>
            </div>
            <span>${currentItem?.kind === "image" ? "Двойной клик, колесо и щепотка работают для изображений." : "Видео открывается во встроенном плеере."}</span>
          </div>
        </div>
      </div>

      ${toast ? html`
        <div className="toast-wrap">
          <div className="toast">
            <strong>${toast.title}</strong>
            <div>${toast.text}</div>
          </div>
        </div>
      ` : null}
    </div>
  `;
}

function clampViewerState(next, stage, naturalWidth, naturalHeight) {
  const renderedWidth = naturalWidth * next.scale;
  const renderedHeight = naturalHeight * next.scale;
  const maxX = Math.max(0, (renderedWidth - stage.clientWidth) / 2);
  const maxY = Math.max(0, (renderedHeight - stage.clientHeight) / 2);
  return {
    ...next,
    offsetX: Math.max(-maxX, Math.min(maxX, next.offsetX)),
    offsetY: Math.max(-maxY, Math.min(maxY, next.offsetY)),
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function pickRandomItems(items, limit) {
  const pool = items.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

function formatVideoTime(seconds, withMilliseconds = false) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
  return withMilliseconds ? `${base}.${String(milliseconds).padStart(3, "0")}` : base;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
