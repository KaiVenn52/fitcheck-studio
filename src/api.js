export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error?.message || 'The request failed.'); error.code = data.error?.code; error.status = response.status; throw error; }
  return data;
}
export async function imagePayload(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
  });
  return { data, type: file.type };
}
