var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/hasDataChanged.ts
var hasDataChanged_exports = {};
__export(hasDataChanged_exports, {
  default: () => hasDataChanged_default,
  isDataChanged: () => isDataChanged
});
module.exports = __toCommonJS(hasDataChanged_exports);
var isAnObject = (obj) => typeof obj === "object" && obj !== null;
var isAnArray = (obj) => Array.isArray(obj);
var hasArrayChanged = (oldArr, newArr) => {
  const isLengthEqual = newArr.length === oldArr.length;
  const arePropertiesEqual = newArr.every((newValue, index) => {
    const oldValue = oldArr[index];
    if (isAnObject(oldValue) && isAnObject(newValue)) {
      const hasChanged = hasDataChanged(oldValue, newValue);
      const isChanged = Object.values(hasChanged).some((value) => value.isModified);
      return !isChanged;
    }
    return oldValue === newValue;
  });
  const isArrayDataChanged = !(isLengthEqual && arePropertiesEqual);
  return isArrayDataChanged;
};
function hasDataChanged(oldObj, newObj) {
  const comp = {};
  try {
    const oldObjEntries = Object.keys(oldObj);
    const newObjEntries = Object.keys(newObj);
    const entries = [.../* @__PURE__ */ new Set([...oldObjEntries, ...newObjEntries])];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry in oldObj && entry in newObj) {
        const newObjEntry = newObj[entry];
        const oldObjEntry = oldObj[entry];
        if (isAnObject(newObjEntry) && isAnObject(oldObjEntry)) {
          if (isAnArray(newObjEntry) && isAnArray(oldObjEntry)) {
            const newArr = newObjEntry;
            const oldArr = oldObjEntry;
            const isArrayDataChanged = hasArrayChanged(oldArr, newArr);
            comp[entry] = { isModified: isArrayDataChanged, prev: oldArr, current: newArr };
          } else {
            const hasObjDataChanged = hasDataChanged(oldObjEntry, newObjEntry);
            const isObjDataChanged = Object.values(hasObjDataChanged).some(
              (value) => value.isModified
            );
            comp[entry] = { isModified: isObjDataChanged, prev: oldObjEntry, current: newObjEntry };
          }
        } else if (newObj[entry] === oldObj[entry]) {
          comp[entry] = { isModified: false, prev: oldObj[entry], current: newObj[entry] };
        } else {
          comp[entry] = { isModified: true, prev: oldObj[entry], current: newObj[entry] };
        }
      } else {
        comp[entry] = { isModified: true, prev: oldObj[entry], current: newObj[entry] };
      }
    }
    return comp;
  } catch (error) {
    console.error(error);
    return comp;
  }
}
var isDataChanged = (oldObj, newObj) => {
  const hasChanged = hasDataChanged(oldObj, newObj);
  const isChanged = Object.values(hasChanged).some((value) => value.isModified);
  if (typeof isChanged === "boolean") return isChanged;
  throw new Error("hasDataChanged retuned a non boolean output eventhough returnBoolean is true.");
};
var hasDataChanged_default = hasDataChanged;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isDataChanged
});
