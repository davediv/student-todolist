export function formatHours(minutes: number) {
	return `${minutes / 60}h`;
}
export function localDate(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function formatDate(
	date: string,
	options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
	locales?: Intl.LocalesArgument,
) {
	const [year, month, day] = date.split("-").map(Number);
	return new Intl.DateTimeFormat(locales, options).format(
		new Date(year, month - 1, day),
	);
}
