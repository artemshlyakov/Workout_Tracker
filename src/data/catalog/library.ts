import data from './exercises.json'
export type LibraryExercise = typeof data[number]
export const muscleLabels: Record<string, string> = { abdominals: 'Пресс', abductors: 'Ягодицы', adductors: 'Бёдра', biceps: 'Бицепс', calves: 'Икры', chest: 'Грудь', forearms: 'Предплечья', glutes: 'Ягодицы', hamstrings: 'Задняя поверхность бедра', lats: 'Спина', 'lower back': 'Поясница', 'middle back': 'Спина', neck: 'Шея', quadriceps: 'Квадрицепсы', shoulders: 'Плечи', traps: 'Трапеции', triceps: 'Трицепс' }
export const equipmentLabels: Record<string, string> = { barbell: 'Штанга', dumbbell: 'Гантели', cable: 'Блок', machine: 'Тренажёр', 'body only': 'Свой вес', bands: 'Резинка', kettlebells: 'Гиря', 'e-z curl bar': 'EZ-гриф', 'exercise ball': 'Фитбол', 'foam roll': 'Ролик', 'medicine ball': 'Медбол', other: 'Другое' }
export const library = [...data].sort((a, b) => Number(b.localized) - Number(a.localized) || a.name.localeCompare(b.name, 'ru'))
export const exerciseInfo = (name: string) => library.find((item) => item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru') || item.originalName.toLowerCase() === name.toLowerCase())
const localImages = new Set(data.filter((item) => item.localized).flatMap((item) => item.images))
export const imageUrl = (path: string) => localImages.has(path) ? `${import.meta.env.BASE_URL}exercises/${path}` : `https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/${path}`
export const isLoggable = (item: LibraryExercise) => ['strength', 'powerlifting', 'olympic weightlifting'].includes(item.category) && !['Plank', 'Side_Bridge', 'Isometric_Neck_Exercise_-_Front_And_Back', 'Isometric_Neck_Exercise_-_Sides'].includes(item.id)
export const starterRoutines = [
  { name: 'Всё тело', subtitle: 'Базовый состав · 5 упражнений', names: ['Приседания со штангой', 'Жим штанги лёжа', 'Тяга горизонтального блока', 'Жим гантелей сидя', 'Скручивания'] },
  { name: 'Верх тела', subtitle: 'Грудь, спина, плечи и руки', names: ['Жим гантелей лёжа', 'Тяга верхнего блока широким хватом', 'Тяга гантели одной рукой', 'Подъём гантелей через стороны', 'Сгибание рук с гантелями', 'Разгибание рук с канатом'] },
  { name: 'Ноги и ягодицы', subtitle: 'Нижняя часть тела · 5 упражнений', names: ['Жим ногами', 'Румынская тяга', 'Выпады с гантелями', 'Сгибание ног сидя', 'Подъём на носки стоя'] },
] as const
