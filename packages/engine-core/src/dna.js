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

export const createRestrictionHelpers = (layerRestrictions = []) => {
  const isLayerExcludedByRestrictions = (layerName, currentPicks) => {
    return layerRestrictions.some((r) => {
      if (!r.excludeLayers || !r.excludeLayers.includes(layerName)) return false;
      const when = r.when;
      const triggerElements = Array.isArray(when.element)
        ? when.element
        : [when.element];
      const actualValue = currentPicks[when.layer];
      return actualValue && triggerElements.includes(actualValue);
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
      const when = r.when;
      const triggerElements = Array.isArray(when.element)
        ? when.element
        : [when.element];
      const actualValue = picks[when.layer];
      if (actualValue && triggerElements.includes(actualValue)) {
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
      const pickId = Number(cleanDna(pickStr.split(":")[0]));
      const element = layer.elements.find((e) => e.id === pickId);
      if (element) picks[layerKey(layer)] = element.name;
    });

    for (const r of layerRestrictions) {
      if (!r.excludeElements) continue;
      const triggerElements = Array.isArray(r.when.element)
        ? r.when.element
        : [r.when.element];
      const actualValue = picks[r.when.layer];
      if (!actualValue || !triggerElements.includes(actualValue)) continue;

      for (const [layerName, excludedElementNames] of Object.entries(
        r.excludeElements
      )) {
        const layerIndex = _layers.findIndex((l) => layerKey(l) === layerName);
        if (layerIndex === -1) continue;
        const currentPick = picks[layerName];
        if (!currentPick || !excludedElementNames.includes(currentPick))
          continue;

        const layer = _layers[layerIndex];
        const allowedElements = layer.elements.filter(
          (e) => !excludedElementNames.includes(e.name)
        );
        if (allowedElements.length === 0) continue;

        let totalWeight = 0;
        allowedElements.forEach((el) => {
          totalWeight += el.weight;
        });
        let random = Math.floor(Math.random() * totalWeight);
        for (let i = 0; i < allowedElements.length; i++) {
          random -= allowedElements[i].weight;
          if (random < 0) {
            const element = allowedElements[i];
            randNumArray[layerIndex] = `${element.id}:${element.filename}${
              layer.bypassDNA ? "?bypassDNA=true" : ""
            }`;
            return fixExcludeElementsViolations(randNumArray, _layers);
          }
        }
        const element = allowedElements[allowedElements.length - 1];
        randNumArray[layerIndex] = `${element.id}:${element.filename}${
          layer.bypassDNA ? "?bypassDNA=true" : ""
        }`;
        return fixExcludeElementsViolations(randNumArray, _layers);
      }
    }
    return randNumArray;
  };

  const createDna = (_layers) => {
    let randNum = [];
    _layers.forEach((layer, layerIndex) => {
      const currentPicks = {};
      for (let j = 0; j < layerIndex; j++) {
        const pickStr = randNum[j];
        const pickId = Number(cleanDna(pickStr.split(":")[0]));
        const prevLayer = _layers[j];
        const element = prevLayer.elements.find((e) => e.id === pickId);
        if (element) {
          currentPicks[layerKey(prevLayer)] = element.name;
        }
      }

      if (isLayerExcludedByRestrictions(layerKey(layer), currentPicks)) {
        const first = layer.elements[0];
        randNum.push(
          `${first.id}:${first.filename}${
            layer.bypassDNA ? "?bypassDNA=true" : ""
          }`
        );
        return;
      }

      let totalWeight = 0;
      layer.elements.forEach((element) => {
        totalWeight += element.weight;
      });
      let random = Math.floor(Math.random() * totalWeight);
      for (let i = 0; i < layer.elements.length; i++) {
        random -= layer.elements[i].weight;
        if (random < 0) {
          randNum.push(
            `${layer.elements[i].id}:${layer.elements[i].filename}${
              layer.bypassDNA ? "?bypassDNA=true" : ""
            }`
          );
          return;
        }
      }
      if (layer.elements.length > 0) {
        const last = layer.elements[layer.elements.length - 1];
        randNum.push(
          `${last.id}:${last.filename}${
            layer.bypassDNA ? "?bypassDNA=true" : ""
          }`
        );
      }
    });
    fixExcludeElementsViolations(randNum, _layers);
    return randNum.join(DNA_DELIMITER);
  };

  return {
    createDna,
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
    return `${element.id}:${element.filename}${
      layer.bypassDNA ? "?bypassDNA=true" : ""
    }`;
  });
  return parts.join(DNA_DELIMITER);
};
