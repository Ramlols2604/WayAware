export type AgeGroup = 'child' | 'young-adult' | 'adult' | 'older-adult'
export type Gender = 'female' | 'male' | 'other'
export type TravelMode = 'walking' | 'bike' | 'car' | 'transit'

export type Profile = {
  age: AgeGroup
  gender: Gender
  travel: TravelMode[]
}

export const ageOptions: { id: AgeGroup; label: string; range: string }[] = [
  { id: 'child', label: 'Child', range: '0–14' },
  { id: 'young-adult', label: 'Young Adult', range: '15–20' },
  { id: 'adult', label: 'Adult', range: '21–54' },
  { id: 'older-adult', label: 'Older Adult', range: '55+' },
]

export const genderOptions: { id: Gender; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'other', label: 'Other' },
]

export const travelOptions: { id: TravelMode; label: string; icon: TravelMode }[] = [
  { id: 'walking', label: 'Walking', icon: 'walking' },
  { id: 'bike', label: 'Bike', icon: 'bike' },
  { id: 'car', label: 'Car', icon: 'car' },
  { id: 'transit', label: 'Public Transport', icon: 'transit' },
]
