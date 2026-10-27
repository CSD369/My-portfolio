(() => {
  "use strict";

  const root = document.documentElement;
  const reveals = [...document.querySelectorAll("[data-reveal]")];
  const motionButtons = [...document.querySelectorAll("[data-motion-toggle]")];
  const replayButtons = [...document.querySelectorAll("[data-replay-intro]")];
  const showAll = () => reveals.forEach((element) => element.classList.add("is-visible"));
  let cleanUpMotion = () => {};

  try {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const storageKey = "portfolio-motion-paused";
    let userPaused = false;
    let scrollFrame = 0;
    let introFrame = 0;
    let introTimer = 0;
    let revealObserver;
    let revealExitObserver;
    let canvasFrame = 0;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let canvasDpr = 1;
    let lastPaint = 0;
    let sceneTime = 0;
    let scrollProgress = 0;
    const pointerStates = [];
    const glowPointer = { x: .65, y: .35, targetX: .65, targetY: .35 };
    const canvas = document.querySelector("#ambient-canvas");
    let context = null;
    try { context = canvas?.getContext("2d", { alpha: true }); } catch {}
    try { userPaused = localStorage.getItem(storageKey) === "true"; } catch {}

    const motionAllowed = () => !userPaused && !reducedMotion.matches;
    const canAnimate = () => motionAllowed() && !document.hidden;
    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const scrollSections = [...document.querySelectorAll("[data-scroll-section]")];
    const parallaxElements = [...document.querySelectorAll("[data-parallax]")];
    const routes = [...document.querySelectorAll("[data-route-progress]")];
    const stickyHeader = document.querySelector(".market-header");
    const navLinks = [...document.querySelectorAll("[data-nav-link]")].map((link) => ({
      link,
      target: document.getElementById((link.getAttribute("href") || "").replace(/^#/, ""))
    })).filter(({ target }) => target);
    const filterButtons = [...document.querySelectorAll("[data-tool-filter]")];
    const toolCards = [...document.querySelectorAll("[data-tool-category]")];
    const filterStatus = document.querySelector("[data-filter-status]");
    const filterNames = { all: "all tools", systems: "systems tools", analytics: "analytics tools", planning: "planning tools" };

    function setToolFilter(value, announce = true) {
      const filter = Object.hasOwn(filterNames, value) ? value : "all";
      let count = 0;
      toolCards.forEach((card) => {
        const categories = (card.dataset.toolCategory || "").split(/\s+/);
        card.hidden = filter !== "all" && !categories.includes(filter);
        if (!card.hidden) count += 1;
      });
      filterButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.toolFilter === filter)));
      if (announce && filterStatus) filterStatus.textContent = `Showing ${count} ${filterNames[filter]}.`;
      scheduleScrollUpdate();
    }
    filterButtons.forEach((button) => button.addEventListener("click", () => setToolFilter(button.dataset.toolFilter)));

    // Local search reads only the declared portfolio content. Results are built
    // with textContent so neither a query nor an attribute becomes markup.
    const searchForm = document.querySelector("form[data-portfolio-search]");
    const searchInput = document.querySelector("#portfolio-search");
    const searchResults = document.querySelector("#search-results");
    const searchStatus = document.querySelector("#search-status");
    const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
    const corpus = [...document.querySelectorAll("[data-search-title][data-search-keywords]")]
      .filter((target) => target.id)
      .map((target) => ({ target, title: target.dataset.searchTitle, description: target.dataset.searchDescription || "",
        searchable: normalize(`${target.dataset.searchTitle} ${target.dataset.searchKeywords} ${target.dataset.searchDescription || ""}`) }));

    function closeSearch() {
      if (searchResults) searchResults.hidden = true;
      if (searchStatus) searchStatus.textContent = "";
    }
    function renderSearch(browse = false) {
      if (!searchInput || !searchResults) return;
      const query = normalize(searchInput.value).slice(0, 200);
      if (!query && !browse) { closeSearch(); return; }
      const terms = query.split(/\s+/).filter(Boolean);
      const matches = corpus.filter((item) => terms.every((term) => item.searchable.includes(term)))
        .sort((a, b) => Number(normalize(b.title).startsWith(query)) - Number(normalize(a.title).startsWith(query)))
        .slice(0, 8);
      searchResults.replaceChildren();
      searchResults.hidden = false;
      if (!matches.length) {
        const empty = document.createElement("p");
        empty.className = "search-empty";
        empty.textContent = "No matches. Try a skill, role, or project name.";
        searchResults.append(empty);
        if (searchStatus) searchStatus.textContent = empty.textContent;
        return;
      }
      const list = document.createElement("ul");
      list.className = "search-result-list";
      matches.forEach(({ target, title, description }) => {
        const item = document.createElement("li");
        item.className = "search-result";
        const link = document.createElement("a");
        link.className = "search-result-link";
        link.setAttribute("href", `#${target.id}`);
        const heading = document.createElement("strong");
        heading.className = "search-result-title";
        heading.textContent = title;
        link.append(heading);
        if (description) {
          const summary = document.createElement("span");
          summary.className = "search-result-description";
          summary.textContent = description;
          link.append(summary);
        }
        link.addEventListener("click", () => {
          const tool = target.closest("[data-tool-category]");
          if (tool?.hidden) setToolFilter("all");
          closeSearch();
          // Move keyboard focus with the destination when the results close.
          const temporaryTabIndex = !target.hasAttribute("tabindex");
          if (temporaryTabIndex) target.setAttribute("tabindex", "-1");
          target.classList.add("is-visible");
          target.focus({ preventScroll: true });
          if (temporaryTabIndex) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
        });
        item.append(link);
        list.append(item);
      });
      searchResults.append(list);
      if (searchStatus) searchStatus.textContent = query ? `${matches.length} portfolio ${matches.length === 1 ? "match" : "matches"}.` : "Browse portfolio sections and tools.";
    }
    searchForm?.addEventListener("submit", (event) => { event.preventDefault(); renderSearch(true); });
    searchInput?.addEventListener("input", () => renderSearch());
    document.addEventListener("pointerdown", (event) => {
      if (!searchResults?.hidden && !searchForm?.contains(event.target) && !searchResults?.contains(event.target)) closeSearch();
    });

    function finishIntro() {
      clearTimeout(introTimer);
      cancelAnimationFrame(introFrame);
      root.classList.remove("is-opening");
    }
    function playIntro() {
      finishIntro();
      if (!canAnimate()) return;
      void root.offsetWidth;
      introFrame = requestAnimationFrame(() => {
        if (!canAnimate()) return;
        root.classList.add("is-opening");
        introTimer = window.setTimeout(finishIntro, 1800);
      });
    }
    function observeReveals() {
      if (!canAnimate() || !("IntersectionObserver" in window)) {
        revealObserver?.disconnect();
        revealExitObserver?.disconnect();
        showAll();
        return;
      }
      revealObserver ??= new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting) target.classList.add("is-visible");
        });
      }, { rootMargin: "0px", threshold: 0 });
      // Enter at the viewport edge, then reset only well outside it. Separate
      // margins prevent a reveal's own transform from toggling it repeatedly.
      revealExitObserver ??= new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) target.classList.remove("is-visible");
        });
      }, { rootMargin: "100px 0px 100px 0px", threshold: 0 });
      reveals.forEach((element) => {
        revealObserver.observe(element);
        revealExitObserver.observe(element);
      });
    }

    function resetPointer(state) {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.element.classList.remove("is-pointer-active");
      for (const [name, value] of [["--pointer-x", "50%"], ["--pointer-y", "50%"], ["--tilt-x", "0deg"], ["--tilt-y", "0deg"], ["--magnetic-x", "0px"], ["--magnetic-y", "0px"]]) state.element.style.setProperty(name, value);
    }
    document.querySelectorAll("[data-glass], [data-magnetic]").forEach((element) => {
      const state = { element, frame: 0, x: 0, y: 0 };
      pointerStates.push(state);
      element.addEventListener("pointermove", (event) => {
        if (!canAnimate() || !finePointer.matches || event.pointerType === "touch") return;
        state.x = event.clientX;
        state.y = event.clientY;
        if (state.frame) return;
        state.frame = requestAnimationFrame(() => {
          state.frame = 0;
          if (!canAnimate() || !finePointer.matches) return;
          const bounds = element.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          const x = clamp((state.x - bounds.left) / bounds.width);
          const y = clamp((state.y - bounds.top) / bounds.height);
          element.classList.add("is-pointer-active");
          if (element.hasAttribute("data-glass")) {
            element.style.setProperty("--pointer-x", `${x * 100}%`);
            element.style.setProperty("--pointer-y", `${y * 100}%`);
            element.style.setProperty("--tilt-x", `${(0.5 - y) * 4}deg`);
            element.style.setProperty("--tilt-y", `${(x - 0.5) * 4}deg`);
          }
          if (element.hasAttribute("data-magnetic")) {
            element.style.setProperty("--magnetic-x", `${(x - .5) * 6}px`);
            element.style.setProperty("--magnetic-y", `${(y - .5) * 6}px`);
          }
        });
      }, { passive: true });
      element.addEventListener("pointerleave", () => resetPointer(state), { passive: true });
      element.addEventListener("pointercancel", () => resetPointer(state), { passive: true });
    });
    finePointer.addEventListener("change", () => pointerStates.forEach(resetPointer));

    function updateScroll() {
      scrollFrame = 0;
      if (document.hidden) return;
      const viewport = window.innerHeight;
      const distance = root.scrollHeight - root.clientHeight;
      scrollProgress = distance > 0 ? clamp(window.scrollY / distance) : 0;
      root.style.setProperty("--scroll-progress", String(scrollProgress));
      root.style.setProperty("--scroll-y", `${window.scrollY}px`);
      const moving = canAnimate();
      scrollSections.forEach((section) => {
        const bounds = section.getBoundingClientRect();
        if (bounds.top > viewport + 300 || bounds.bottom < -300) return;
        const progress = clamp((viewport - bounds.top) / (viewport + bounds.height));
        section.style.setProperty("--section-progress", progress.toFixed(4));
        section.style.setProperty("--section-shift", moving ? `${((progress - .5) * 72).toFixed(2)}px` : "0px");
      });
      parallaxElements.forEach((element) => {
        if (!moving) { element.style.setProperty("--parallax-y", "0px"); return; }
        const bounds = element.getBoundingClientRect();
        if (bounds.top > viewport + 200 || bounds.bottom < -200) return;
        const declaredSpeed = Number.parseFloat(element.dataset.parallax);
        const speed = Number.isFinite(declaredSpeed) ? clamp(declaredSpeed, -.4, .4) : .08;
        element.style.setProperty("--parallax-y", `${clamp((viewport / 2 - bounds.top - bounds.height / 2) * speed, -40, 40).toFixed(2)}px`);
      });
      routes.forEach((route) => {
        const bounds = route.getBoundingClientRect();
        route.style.setProperty("--route-progress", String(clamp((viewport * .75 - bounds.top) / Math.max(1, bounds.height))));
      });
      let current;
      const headerOffset = stickyHeader ? stickyHeader.getBoundingClientRect().height + 24 : viewport * .3;
      const anchorOffset = Number.parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      const activationLine = Math.min(viewport * .8, Math.max(headerOffset, anchorOffset + 4));
      navLinks.forEach(({ target }) => {
        const bounds = target.getBoundingClientRect();
        if (bounds.top <= activationLine && bounds.bottom > 0) current = target.id;
      });
      navLinks.forEach(({ link, target }) => {
        if (target.id === current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }
    function scheduleScrollUpdate() {
      if (!scrollFrame && !document.hidden) scrollFrame = requestAnimationFrame(updateScroll);
    }

    // A decorative lighting scene. All coordinates are normalized so resizing
    // retains the composition; drawing is capped at 30 fps and 1.5 device pixels.
    const particles = Array.from({ length: 30 }, (_, index) => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .009,
      vy: (Math.random() - .5) * .012, radius: 1.2 + Math.random() * 1.4, amber: index % 5 === 0
    }));
    function bloom(x, y, radius, color, opacity) {
      const light = context.createRadialGradient(x, y, 0, x, y, radius);
      light.addColorStop(0, `rgba(${color},${opacity})`);
      light.addColorStop(.45, `rgba(${color},${opacity * .38})`);
      light.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = light;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    function paintScene(delta = 0) {
      if (!context || !canvasWidth || !canvasHeight) return;
      sceneTime += delta;
      context.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      const mobile = canvasWidth < 700;
      const activeParticles = particles.slice(0, mobile ? 14 : 30);
      const cyanX = canvasWidth * (.14 + Math.sin(sceneTime * .17) * .09 + scrollProgress * .1);
      const cyanY = canvasHeight * (.26 + Math.cos(sceneTime * .12) * .15);
      const amberX = canvasWidth * (.86 + Math.cos(sceneTime * .13) * .07);
      const amberY = canvasHeight * (.65 + Math.sin(sceneTime * .15) * .18);
      bloom(cyanX, cyanY, Math.max(350, canvasWidth * .43), "34,211,238", .15);
      bloom(amberX, amberY, Math.max(310, canvasWidth * .36), "245,158,11", .105);
      glowPointer.x += (glowPointer.targetX - glowPointer.x) * Math.min(1, delta * 5);
      glowPointer.y += (glowPointer.targetY - glowPointer.y) * Math.min(1, delta * 5);
      bloom(glowPointer.x * canvasWidth, glowPointer.y * canvasHeight, mobile ? 170 : 270, "103,232,249", .1);
      activeParticles.forEach((particle) => {
        particle.x = (particle.x + particle.vx * delta + 1) % 1;
        particle.y = (particle.y + particle.vy * delta + 1) % 1;
      });
      const maxDistance = mobile ? 125 : 190;
      activeParticles.forEach((particle, index) => {
        const x = particle.x * canvasWidth;
        const y = particle.y * canvasHeight;
        for (let next = index + 1; next < activeParticles.length; next += 1) {
          const other = activeParticles[next];
          const otherX = other.x * canvasWidth;
          const otherY = other.y * canvasHeight;
          const distance = Math.hypot(x - otherX, y - otherY);
          if (distance >= maxDistance) continue;
          context.strokeStyle = `rgba(103,232,249,${(1 - distance / maxDistance) * .14})`;
          context.lineWidth = .65;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(otherX, otherY);
          context.stroke();
        }
        context.fillStyle = particle.amber ? "rgba(251,191,36,.48)" : "rgba(103,232,249,.48)";
        context.beginPath();
        context.arc(x, y, particle.radius, 0, Math.PI * 2);
        context.fill();
      });
    }
    function sizeCanvas() {
      if (!context || !canvas) return;
      canvasWidth = window.innerWidth;
      canvasHeight = window.innerHeight;
      canvasDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(canvasWidth * canvasDpr);
      canvas.height = Math.round(canvasHeight * canvasDpr);
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      paintScene();
    }
    function stopCanvas() {
      cancelAnimationFrame(canvasFrame);
      canvasFrame = 0;
      lastPaint = 0;
    }
    function animateCanvas(timestamp) {
      canvasFrame = 0;
      if (!canAnimate() || !context) return;
      if (!lastPaint || timestamp - lastPaint >= 1000 / 30) {
        const delta = lastPaint ? Math.min((timestamp - lastPaint) / 1000, .08) : 0;
        paintScene(delta);
        lastPaint = timestamp;
      }
      canvasFrame = requestAnimationFrame(animateCanvas);
    }
    function startCanvas() {
      if (!canvasFrame && context && canAnimate()) canvasFrame = requestAnimationFrame(animateCanvas);
    }

    function syncMotion() {
      root.classList.toggle("motion-paused", !canAnimate());
      motionButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(!motionAllowed()));
        button.disabled = reducedMotion.matches;
        const label = button.querySelector("[data-motion-label]");
        if (label) label.textContent = reducedMotion.matches ? "Reduced motion" : userPaused ? "Resume motion" : "Pause motion";
        button.title = reducedMotion.matches ? "Your device's reduced-motion preference is enabled." : "";
      });
      replayButtons.forEach((button) => {
        button.disabled = !motionAllowed();
        button.setAttribute("aria-disabled", String(!motionAllowed()));
      });
      if (!canAnimate()) {
        finishIntro();
        stopCanvas();
        pointerStates.forEach(resetPointer);
        scrollSections.forEach((section) => section.style.setProperty("--section-shift", "0px"));
        parallaxElements.forEach((element) => element.style.setProperty("--parallax-y", "0px"));
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        if (!document.hidden) paintScene();
      } else startCanvas();
      observeReveals();
      if (!document.hidden) scheduleScrollUpdate();
    }
    cleanUpMotion = () => {
      finishIntro();
      stopCanvas();
      cancelAnimationFrame(scrollFrame);
      revealObserver?.disconnect();
      revealExitObserver?.disconnect();
      pointerStates.forEach(resetPointer);
    };

    motionButtons.forEach((button) => button.addEventListener("click", () => {
      if (reducedMotion.matches) return;
      userPaused = !userPaused;
      try { localStorage.setItem(storageKey, String(userPaused)); } catch {}
      syncMotion();
    }));
    replayButtons.forEach((button) => button.addEventListener("click", playIntro));
    reducedMotion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
    window.addEventListener("resize", () => { sizeCanvas(); scheduleScrollUpdate(); }, { passive: true });
    window.addEventListener("load", scheduleScrollUpdate, { once: true });
    document.addEventListener("pointermove", (event) => {
      if (!canAnimate() || !finePointer.matches || event.pointerType === "touch") return;
      glowPointer.targetX = clamp(event.clientX / Math.max(1, canvasWidth));
      glowPointer.targetY = clamp(event.clientY / Math.max(1, canvasHeight));
    }, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Tab") finishIntro();
      if (event.key === "Escape" && searchResults && !searchResults.hidden) {
        closeSearch();
        searchInput?.focus({ preventScroll: true });
      }
    });

    sizeCanvas();
    syncMotion();
    root.classList.add("motion-ready");
    setToolFilter("all", false);
    playIntro();
    [...motionButtons, ...replayButtons].forEach((button) => { button.hidden = false; });
  } catch {
    // Enhancement failure leaves every portfolio section readable and static.
    cleanUpMotion();
    root.classList.remove("motion-ready", "is-opening");
    root.classList.add("motion-paused");
    showAll();
    document.querySelectorAll("[data-tool-category]").forEach((card) => { card.hidden = false; });
    [...motionButtons, ...replayButtons].forEach((button) => { button.hidden = true; button.disabled = true; });
  }
})();
