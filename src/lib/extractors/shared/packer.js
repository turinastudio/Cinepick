const packedRegex = /eval\(function\(p,a,c,k,e,.*\)\)/i;

function getPacked(text) {
  return packedRegex.test(text) ? packedRegex.exec(text)?.[0] || null : null;
}

function createUnbase(radix) {
  const alphabet62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const alphabet95 = " !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

  if (radix <= 36) {
    return (value) => Number.parseInt(value, radix);
  }

  let alphabet = null;

  if (radix < 62) {
    alphabet = alphabet62.slice(0, radix);
  } else if (radix >= 63 && radix <= 94) {
    alphabet = alphabet95.slice(0, radix);
  } else if (radix === 62) {
    alphabet = alphabet62;
  } else if (radix === 95) {
    alphabet = alphabet95;
  }

  if (!alphabet) {
    return (value) => Number.parseInt(value, radix);
  }

  const dictionary = new Map(Array.from(alphabet).map((char, index) => [char, index]));

  return (value) => {
    const reversed = value.split("").reverse();
    return reversed.reduce((acc, char, index) => {
      const mapped = dictionary.get(char);
      return acc + (mapped ?? 0) * (radix ** index);
    }, 0);
  };
}

function unpackPackerScript(script) {
  if (!script) {
    return null;
  }

  const packedMatch = script.match(
    /\}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/
  );

  if (!packedMatch) {
    return null;
  }

  const payload = packedMatch[1]?.replaceAll("\\'", "'") || "";
  const radix = Number.parseInt(packedMatch[2], 10) || 36;
  const count = Number.parseInt(packedMatch[3], 10) || 0;
  const symtab = (packedMatch[4] || "").split("|");

  if (symtab.length !== count) {
    return null;
  }

  const unbase = createUnbase(radix);
  const wordPattern = /\b[a-zA-Z0-9_]+\b/g;

  return payload.replace(wordPattern, (word) => {
    const index = unbase(word);
    const replacement = index >= 0 && index < symtab.length ? symtab[index] : null;
    return replacement || word;
  });
}

function getAndUnpack(text) {
  const packed = getPacked(text);
  if (!packed) {
    return text;
  }

  return unpackPackerScript(packed) || text;
}

function unpackWithDictionary(payload, radix, dictionary) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const decodeWord = (word) => {
    let value = 0;
    for (const char of word) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) {
        return Number.NaN;
      }
      value = (value * radix) + digit;
    }
    return value;
  };

  return payload.replace(/\b(\w+)\b/g, (word) => {
    const decodedIndex = decodeWord(word);
    if (Number.isNaN(decodedIndex)) {
      return word;
    }
    return dictionary[decodedIndex] && dictionary[decodedIndex] !== ""
      ? dictionary[decodedIndex]
      : word;
  });
}

export {
  packedRegex,
  getPacked,
  createUnbase,
  unpackPackerScript,
  getAndUnpack,
  unpackWithDictionary
};
