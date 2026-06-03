export const DNA_DELIMITER = "-";

const removeQueryStrings = (_dna) => {
  const query = /(\?.*$)/;
  return _dna.replace(query, "");
};

const cleanDna = (_str) => {
  const withoutOptions = removeQueryStrings(_str);
  return Number(withoutOptions.split(":").shift());
};

export const filterDNAOptions = (_dna) => {
  const dnaItems = _dna.split(DNA_DELIMITER);
  const filteredDNA = dnaItems.filter((element) => {
    const query = /(\?.*$)/;
    const querystring = query.exec(element);
    if (!querystring) return true;
    const options = querystring[1].split("&").reduce((r, setting) => {
      const keyPairs = setting.split("=");
      return { ...r, [keyPairs[0]]: keyPairs[1] };
    }, []);
    return options.bypassDNA;
  });
  return filteredDNA.join(DNA_DELIMITER);
};

export const isDnaUnique = (_DnaList = new Set(), _dna = "") => {
  const _filteredDNA = filterDNAOptions(_dna);
  return !_DnaList.has(_filteredDNA);
};

const layerKey = (layer) => layer.layerKey || layer.name;

const triggerElements = (when) =>
  Array.isArray(when.element) ? when.element : [when.element];

const isTriggerActive = (when, picks) => {
  const actualValue = picks[when.layer];
  return actualValue && triggerElements(when).includes(actualValue);
};

const findElementByPick = (layer, pickStr) => {
  const pickId = cleanDna(pickStr.split(":")[0]);
  return layer.elements.find((e) => e.id == pickId);
};

const weightedPick = (elements, layer) => {
  if (!elements.length) return null;
  let totalWeight = 0;
  elements.forEach((el) => {
    totalWeight += el.weight;
  });
  let random = Math.floor(Math.random() * totalWeight);
  for (let i = 0; i < elements.length; i++) {
    random -= elements[i].weight;
    if (random < 0) {
      return elements[i];
    }
  }
  return elements[elements.length - 1];
};

const formatPick = (element, layer) =>
  `${element.id}:${element.filename}${
    layer.bypassDNA ? "?bypassDNA=true" : ""
  }`;

export const createRestrictionHelpers = (layerRestrictions = []) => {
  /**
   * For exclude-elements rules: checked traits are blocked when the trigger
   * is active; unchecked traits are dedicated to that trigger and blocked otherwise.
   */
  const getExcludedElementNamesForLayer = (layer, currentPicks) => {
    const layerName = layerKey(layer);
    const excluded = new Set();
    for (const r of layerRestrictions) {
      if (!r.excludeElements) continue;
      const lists = r.excludeElements[layerName];
      if (!lists) continue;

      const triggerLayer = r.when.layer;
      // Layer order often picks EYES before HEAD — until the trigger layer is
      // chosen, do not apply this rule (inactive branch would wrongly allow only
      // the checked/excluded traits such as Out).
      if (!Object.prototype.hasOwnProperty.call(currentPicks, triggerLayer)) {
        continue;
      }

      const active = isTriggerActive(r.when, currentPicks);
      if (active) {
        lists.forEach((n) => excluded.add(n));
      } else {
        for (const el of layer.elements) {
          if (!lists.includes(el.name)) excluded.add(el.name);
        }
      }
    }
    return excluded;
  };

  const isLayerExcludedByRestrictions = (layerName, currentPicks) => {
    return layerRestrictions.some((r) => {
      if (!r.excludeLayers || !r.excludeLayers.includes(layerName)) return false;
      return isTriggerActive(r.when, currentPicks);
    });
  };

  const getExcludedLayerNames = (renderObjectArray) => {
    const picks = {};
    renderObjectArray.forEach((ro) => {
      if (ro.layer.selectedElement) {
        picks[ro.layer.layerKey || ro.layer.name] = ro.layer.selectedElement.name;
      }
    });

    const excluded = new Set();
    layerRestrictions.forEach((r) => {
      if (!r.excludeLayers) return;
      if (isTriggerActive(r.when, picks)) {
        r.excludeLayers.forEach((l) => excluded.add(l));
      }
    });
    return excluded;
  };

  const fixExcludeElementsViolations = (randNumArray, _layers) => {
    const picks = {};
    _layers.forEach((layer, index) => {
      const pickStr = randNumArray[index];
      if (!pickStr) return;
      const element = findElementByPick(layer, pickStr);
      if (element) picks[layerKey(layer)] = element.name;
    });

    for (let layerIndex = 0; layerIndex < _layers.length; layerIndex++) {
      const layer = _layers[layerIndex];
      const name = layerKey(layer);
      const currentPick = picks[name];
      if (!currentPick) continue;

      const excludedNames = getExcludedElementNamesForLayer(layer, picks);
      if (!excludedNames.has(currentPick)) continue;

      const allowedElements = layer.elements.filter(
        (e) => !excludedNames.has(e.name)
      );
      if (allowedElements.length === 0) continue;

      const element = weightedPick(allowedElements, layer);
      randNumArray[layerIndex] = formatPick(element, layer);
      return fixExcludeElementsViolations(randNumArray, _layers);
    }

    return randNumArray;
  };

  const createDna = (_layers) => {
    let randNum = [];
    _layers.forEach((layer, layerIndex) => {
      const currentPicks = {};
      for (let j = 0; j < layerIndex; j++) {
        const pickStr = randNum[j];
        const element = findElementByPick(_layers[j], pickStr);
        if (element) {
          currentPicks[layerKey(_layers[j])] = element.name;
        }
      }

      if (isLayerExcludedByRestrictions(layerKey(layer), currentPicks)) {
        const first = layer.elements[0];
        randNum.push(formatPick(first, layer));
        return;
      }

      const excludedNames = getExcludedElementNamesForLayer(layer, currentPicks);
      const pool = layer.elements.filter((e) => !excludedNames.has(e.name));
      const element = weightedPick(
        pool.length ? pool : layer.elements,
        layer
      );
      if (element) {
        randNum.push(formatPick(element, layer));
      }
    });
    enforceExcludeElements(randNum, _layers);
    return randNum.join(DNA_DELIMITER);
  };

  const enforceExcludeElements = (randNumArray, _layers) => {
    const maxPasses = _layers.length * Math.max(layerRestrictions.length, 1) + 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      const before = randNumArray.join("|");
      fixExcludeElementsViolations(randNumArray, _layers);
      if (randNumArray.join("|") === before) break;
    }
    return randNumArray;
  };

  const sanitizeDna = (dna, _layers) => {
    const parts = dna.split(DNA_DELIMITER);
    if (parts.length !== _layers.length) return dna;
    enforceExcludeElements(parts, _layers);
    return parts.join(DNA_DELIMITER);
  };

  return {
    createDna,
    sanitizeDna,
    isLayerExcludedByRestrictions,
    getExcludedLayerNames,
    fixExcludeElementsViolations,
  };
};

export const constructLayerToDna = (_dna = "", _layers = []) => {
  return _layers.map((layer, index) => {
    const selectedElement = layer.elements.find(
      (e) => e.id == cleanDna(_dna.split(DNA_DELIMITER)[index])
    );
    return {
      name: layer.name,
      layerKey: layerKey(layer),
      blend: layer.blend,
      opacity: layer.opacity,
      selectedElement,
    };
  });
};

export const dnaFromSelections = (layers, selectedTraits) => {
  const parts = layers.map((layer) => {
    const traitName = selectedTraits[layer.layerKey] || selectedTraits[layer.name];
    const element =
      layer.elements.find((e) => e.name === traitName) || layer.elements[0];
    return formatPick(element, layer);
  });
  return parts.join(DNA_DELIMITER);
};
