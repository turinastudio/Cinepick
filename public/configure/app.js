const state = {
  capabilities: null,
  defaultConfig: null,
  config: null
};

function getConfigQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("config") || "";
}

async function loadState() {
  const query = getConfigQuery();
  const url = query
    ? `/configure/state.json?config=${encodeURIComponent(query)}`
    : "/configure/state.json";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo cargar el estado del panel: ${response.status}`);
  }
  return response.json();
}

function createToggle({ checked, disabled = false, label, description, pill, onChange }) {
  const wrapper = document.createElement("label");
  wrapper.className = "toggle-row";
  wrapper.dataset.disabled = disabled ? "true" : "false";

  const copy = document.createElement("div");
  copy.className = "toggle-copy";
  copy.innerHTML = `<strong>${label}</strong><div class="switch-meta">${description}</div>`;

  if (pill) {
    const pillNode = document.createElement("span");
    pillNode.className = "pill";
    pillNode.textContent = pill;
    copy.appendChild(pillNode);
  }

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));

  wrapper.append(copy, input);
  return wrapper;
}

function renderGeneralSection() {
  const root = document.getElementById("general-section");
  root.replaceChildren();

  const modeLabel = document.createElement("label");
  modeLabel.className = "stack";
  modeLabel.innerHTML = "<strong>Modo de seleccion</strong>";
  const modeSelect = document.createElement("select");
  [
    ["global", "Global recomendado"],
    ["per_provider", "Por provider"],
    ["off", "Sin ranking"]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.config.selection.mode === value;
    modeSelect.appendChild(option);
  });
  modeSelect.addEventListener("change", () => {
    state.config.selection.mode = modeSelect.value;
    updateView();
  });
  modeLabel.appendChild(modeSelect);

  const maxLabel = document.createElement("label");
  maxLabel.className = "stack";
  maxLabel.innerHTML = "<strong>Maximo de resultados</strong>";
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "1";
  maxInput.max = "50";
  maxInput.value = String(state.config.selection.maxResults);
  maxInput.addEventListener("change", () => {
    const nextValue = Number.parseInt(maxInput.value, 10);
    state.config.selection.maxResults = Number.isInteger(nextValue) ? nextValue : 2;
    updateView();
  });
  maxLabel.appendChild(maxInput);

  root.appendChild(modeLabel);
  root.appendChild(maxLabel);
  root.appendChild(
    createToggle({
      checked: state.config.selection.internalOnly,
      label: "Preferir solo streams internos",
      description: "Si esta activo, se priorizan solo streams reproducibles dentro de Stremio.",
      onChange: (checked) => {
        state.config.selection.internalOnly = checked;
        updateView();
      }
    })
  );
  root.appendChild(
    createToggle({
      checked: state.config.support.showSupportStream,
      label: "Mostrar stream de apoyo",
      description: "Agrega la opcion de apoyo al final de la lista cuando hay streams.",
      onChange: (checked) => {
        state.config.support.showSupportStream = checked;
        updateView();
      }
    })
  );
}

function renderEngines() {
  const root = document.getElementById("engines-section");
  root.replaceChildren();

  state.capabilities.engines.forEach((engine) => {
    root.appendChild(
      createToggle({
        checked: Boolean(state.config.engines[engine.id]),
        disabled: !engine.available,
        label: engine.label,
        description: engine.available ? engine.description : "No disponible en este deploy.",
        onChange: (checked) => {
          state.config.engines[engine.id] = checked;
          updateView();
        }
      })
    );
  });
}

function renderProviderSection(rootId, engineId) {
  const root = document.getElementById(rootId);
  root.replaceChildren();

  const engineEnabled = Boolean(state.config.engines[engineId]);

  state.capabilities.providers[engineId].forEach((provider) => {
    root.appendChild(
      createToggle({
        checked: Boolean(state.config.providers[engineId][provider.id]),
        disabled: !provider.available || !engineEnabled,
        label: provider.name,
        description: provider.available
          ? (engineEnabled ? `Provider ${provider.id}` : "Activa primero el motor correspondiente.")
          : "No disponible en este deploy.",
        onChange: (checked) => {
          state.config.providers[engineId][provider.id] = checked;
          updateView();
        }
      })
    );
  });
}

function renderExtractorSection(rootId, section) {
  const root = document.getElementById(rootId);
  root.replaceChildren();

  state.capabilities.extractors
    .filter((extractor) => extractor.section === section)
    .forEach((extractor) => {
      const scopes = extractor.scopes.includes("general") && extractor.scopes.includes("anime")
        ? "General + Anime"
        : extractor.scopes.includes("anime")
          ? "Anime"
          : "General";

      root.appendChild(
        createToggle({
          checked: Boolean(state.config.extractors.enabled[extractor.id]),
          disabled: !extractor.available,
          label: extractor.label,
          description: `${extractor.description} Alcance: ${scopes}.`,
          pill: extractor.mode === "external_preferred"
            ? "Externo recomendado"
            : extractor.mode === "internal_experimental"
              ? "Experimental"
              : "Interno recomendado",
          onChange: (checked) => {
            state.config.extractors.enabled[extractor.id] = checked;
            updateView();
          }
        })
      );
    });
}

function normalizedConfigForUrl() {
  return {
    version: state.config.version,
    preset: state.config.preset,
    engines: { ...state.config.engines },
    providers: {
      general: { ...state.config.providers.general },
      anime: { ...state.config.providers.anime }
    },
    extractors: {
      enabled: { ...state.config.extractors.enabled }
    },
    selection: { ...state.config.selection },
    support: { ...state.config.support }
  };
}

function encodeConfig(config) {
  const json = JSON.stringify(config);
  return btoa(unescape(encodeURIComponent(json)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function updateSummary(token) {
  const engines = Object.entries(state.config.engines).filter(([, enabled]) => enabled).length;
  const providers = [
    ...Object.values(state.config.providers.general),
    ...Object.values(state.config.providers.anime)
  ].filter(Boolean).length;
  const extractors = Object.values(state.config.extractors.enabled).filter(Boolean).length;

  document.getElementById("summary-engines").textContent = String(engines);
  document.getElementById("summary-providers").textContent = String(providers);
  document.getElementById("summary-extractors").textContent = String(extractors);

  const manifestUrl = `${window.location.origin}/c/${token}/manifest.json`;
  document.getElementById("manifest-url").textContent = manifestUrl;
  const installLink = document.getElementById("install-link");
  installLink.href = manifestUrl;
  document.getElementById("copy-link").onclick = async () => {
    await navigator.clipboard.writeText(manifestUrl);
    document.getElementById("copy-link").textContent = "URL copiada";
    window.setTimeout(() => {
      document.getElementById("copy-link").textContent = "Copiar URL";
    }, 1200);
  };
}

function applyBulkActions() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.action;
      if (action === "all-general-on") {
        state.capabilities.providers.general.forEach((provider) => {
          if (provider.available) {
            state.config.providers.general[provider.id] = true;
          }
        });
      } else if (action === "general-reset") {
        state.capabilities.providers.general.forEach((provider) => {
          state.config.providers.general[provider.id] = Boolean(state.defaultConfig.providers.general[provider.id]);
        });
      } else if (action === "all-anime-on") {
        state.capabilities.providers.anime.forEach((provider) => {
          if (provider.available) {
            state.config.providers.anime[provider.id] = true;
          }
        });
      } else if (action === "anime-reset") {
        state.capabilities.providers.anime.forEach((provider) => {
          state.config.providers.anime[provider.id] = Boolean(state.defaultConfig.providers.anime[provider.id]);
        });
      }

      updateView();
    };
  });
}

function updateView() {
  renderGeneralSection();
  renderEngines();
  renderProviderSection("providers-general-section", "general");
  renderProviderSection("providers-anime-section", "anime");
  renderExtractorSection("extractors-reliable-section", "reliable");
  renderExtractorSection("extractors-experimental-section", "experimental");
  const token = encodeConfig(normalizedConfigForUrl());
  updateSummary(token);
  applyBulkActions();
}

async function main() {
  const payload = await loadState();
  state.capabilities = payload.capabilities;
  state.defaultConfig = payload.defaultConfig;
  state.config = payload.config;

  document.getElementById("reset-button").onclick = () => {
    state.config = JSON.parse(JSON.stringify(state.defaultConfig));
    updateView();
  };

  updateView();
}

main().catch((error) => {
  const root = document.querySelector(".page");
  root.innerHTML = `<section class="hero"><p class="eyebrow">Error</p><h1>No se pudo cargar el panel</h1><p class="hero-copy">${error instanceof Error ? error.message : String(error)}</p></section>`;
});
