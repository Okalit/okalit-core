import { signal, computed, effect } from 'uhtml';

/**
 * Create a reactive form with validation.
 *
 * @param {Object} config
 * @param {Record<string, { value: any, validators?: Function[] }>} config.fields
 * @param {'input'|'blur'|'submit'} [config.validateOn='blur']
 * @returns {FormInstance}
 */
export function createForm({ fields, validateOn = 'blur' } = {}) {
  const fieldEntries = {};
  const fieldNames = Object.keys(fields);

  for (const [name, config] of Object.entries(fields)) {
    const initialValue = config.value;
    const value = signal(initialValue);
    const error = signal(null);
    const touched = signal(false);
    const dirty = computed(() => value.value !== initialValue);
    const validators = config.validators || [];

    fieldEntries[name] = { value, error, touched, dirty, _validators: validators, _initial: initialValue };
  }

  const valid = computed(() =>
    fieldNames.every(name => fieldEntries[name].error.value === null)
  );

  const dirty = computed(() =>
    fieldNames.some(name => fieldEntries[name].dirty.value)
  );

  const errors = computed(() => {
    const result = {};
    for (const name of fieldNames) {
      result[name] = fieldEntries[name].error.value;
    }
    return result;
  });

  // Auto-validate on input/blur based on config
  if (validateOn === 'input') {
    for (const name of fieldNames) {
      effect(() => {
        fieldEntries[name].value.value; // track
        _validateField(name);
      });
    }
  }

  function _validateField(name) {
    const field = fieldEntries[name];
    for (const validator of field._validators) {
      const msg = validator(field.value.value);
      if (msg) {
        field.error.value = msg;
        return false;
      }
    }
    field.error.value = null;
    return true;
  }

  /**
   * Validate a single field (called on blur or manually).
   * @param {string} name
   * @returns {boolean}
   */
  function validateField(name) {
    if (!fieldEntries[name]) return true;
    fieldEntries[name].touched.value = true;
    return _validateField(name);
  }

  /**
   * Validate all fields.
   * @returns {boolean}
   */
  function validate() {
    let allValid = true;
    for (const name of fieldNames) {
      fieldEntries[name].touched.value = true;
      if (!_validateField(name)) allValid = false;
    }
    return allValid;
  }

  /**
   * Get all current form values as a plain object.
   * @returns {Record<string, any>}
   */
  function values() {
    const result = {};
    for (const name of fieldNames) {
      result[name] = fieldEntries[name].value.value;
    }
    return result;
  }

  /**
   * Reset all fields to initial values.
   */
  function reset() {
    for (const name of fieldNames) {
      fieldEntries[name].value.value = fieldEntries[name]._initial;
      fieldEntries[name].error.value = null;
      fieldEntries[name].touched.value = false;
    }
  }

  /**
   * Set external errors (e.g. from server response).
   * @param {Record<string, string>} errorMap
   */
  function setErrors(errorMap) {
    for (const [name, msg] of Object.entries(errorMap)) {
      if (fieldEntries[name]) {
        fieldEntries[name].error.value = msg;
        fieldEntries[name].touched.value = true;
      }
    }
  }

  /**
   * Handle an input event from an input-atom (or similar).
   * Updates value, marks dirty, and validates on input if configured.
   *
   * @param {CustomEvent} event — expects event.detail.name and event.detail.value
   */
  function handleInput(event) {
    const { name, value } = event.detail;
    if (!fieldEntries[name]) return;
    fieldEntries[name].value.value = value;
  }

  /**
   * Handle a blur event from an input-atom.
   * Marks the field as touched and validates if validateOn is 'blur'.
   *
   * @param {CustomEvent} event — expects event.detail.name
   */
  function handleBlur(event) {
    const { name } = event.detail;
    if (!fieldEntries[name]) return;
    fieldEntries[name].touched.value = true;
    if (validateOn === 'blur') _validateField(name);
  }

  return {
    fields: fieldEntries,
    valid,
    dirty,
    errors,
    validate,
    validateField,
    values,
    reset,
    setErrors,
    handleInput,
    handleBlur,
  };
}

// ── Built-in Validators ────────────────────────────────────────

export const required = (msg = 'Required') =>
  (value) => (!value && value !== 0) ? msg : null;

export const email = (msg = 'Invalid email') =>
  (value) => value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? msg : null;

export const minLength = (len, msg) =>
  (value) => value && value.length < len ? (msg || `Min ${len} characters`) : null;

export const maxLength = (len, msg) =>
  (value) => value && value.length > len ? (msg || `Max ${len} characters`) : null;

export const min = (n, msg) =>
  (value) => value !== null && value < n ? (msg || `Min value: ${n}`) : null;

export const max = (n, msg) =>
  (value) => value !== null && value > n ? (msg || `Max value: ${n}`) : null;

export const pattern = (regex, msg = 'Invalid format') =>
  (value) => value && !regex.test(value) ? msg : null;

export const match = (getOtherValue, msg = 'Fields do not match') =>
  (value) => value !== getOtherValue() ? msg : null;
