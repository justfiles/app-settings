// The three natures the summoning offers. A nature seeds the first soul draft and nothing
// after it. It does not choose or record an avatar.

export interface Archetype {
	id: string
	title: string
	tagline: string
	// Warmth, initiative, directness — the shape of the disposition, shown as pips so
	// the three cards read as different characters rather than three words.
	disposition: [number, number, number]
}

export const ARCHETYPES: Archetype[] = [
	{
		id: 'teacher',
		title: 'Teacher',
		tagline: 'Leads you to your own answers.',
		disposition: [4, 2, 2]
	},
	{
		id: 'companion',
		title: 'Companion',
		tagline: 'Beside you, not above you.',
		disposition: [4, 2, 3]
	},
	{
		id: 'assistant',
		title: 'Assistant',
		tagline: 'Gets things done.',
		disposition: [2, 5, 5]
	}
]
