import type { QuizBook } from "./types.js";

const cover = (isbn: string): string => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

const entry = (key: string, title: string, author: string, isbn: string, quote: string): QuizBook => ({
  key,
  title,
  author,
  coverUrl: cover(isbn),
  quote,
  blurb: null
});

/** The curated common pool: famous books most people recognize on sight,
 *  one famous opening line each — famous-lines trivia is the fun one, and
 *  these are short enough to be fair. Cover URLs are OpenLibrary's; a
 *  dead one just means CoverImage's fallback shows for that book. */
export const QUIZ_POOL: QuizBook[] = [
  entry("pool-pride-and-prejudice", "Pride and Prejudice", "Jane Austen", "9780141439518", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife."),
  entry("pool-1984", "1984", "George Orwell", "9780451524935", "It was a bright cold day in April, and the clocks were striking thirteen."),
  entry("pool-moby-dick", "Moby-Dick", "Herman Melville", "9780142437247", "Call me Ishmael."),
  entry("pool-anna-karenina", "Anna Karenina", "Leo Tolstoy", "9780143035008", "Happy families are all alike; every unhappy family is unhappy in its own way."),
  entry("pool-tale-of-two-cities", "A Tale of Two Cities", "Charles Dickens", "9780141439600", "It was the best of times, it was the worst of times."),
  entry("pool-the-hobbit", "The Hobbit", "J. R. R. Tolkien", "9780547928227", "In a hole in the ground there lived a hobbit."),
  entry("pool-fahrenheit-451", "Fahrenheit 451", "Ray Bradbury", "9781451673319", "It was a pleasure to burn."),
  entry("pool-the-metamorphosis", "The Metamorphosis", "Franz Kafka", "9780553213690", "As Gregor Samsa awoke one morning from uneasy dreams, he found himself transformed in his bed into a gigantic insect."),
  entry("pool-peter-pan", "Peter Pan", "J. M. Barrie", "9780142437933", "All children, except one, grow up."),
  entry("pool-old-man-and-the-sea", "The Old Man and the Sea", "Ernest Hemingway", "9780684801223", "He was an old man who fished alone in a skiff in the Gulf Stream and he had gone eighty-four days now without taking a fish."),
  entry("pool-the-great-gatsby", "The Great Gatsby", "F. Scott Fitzgerald", "9780743273565", "In my younger and more vulnerable years my father gave me some advice."),
  entry("pool-the-catcher-in-the-rye", "The Catcher in the Rye", "J. D. Salinger", "9780316769488", "If you really want to hear about it, the first thing you'll probably want to know is where I was born."),
  entry("pool-to-kill-a-mockingbird", "To Kill a Mockingbird", "Harper Lee", "9780061120084", "When he was nearly thirteen, my brother Jem got his arm badly broken at the elbow."),
  entry("pool-the-little-prince", "The Little Prince", "Antoine de Saint-Exupéry", "9780156012195", "The first night, I fell asleep on the sand, a thousand miles from any habitation."),
  entry("pool-the-stranger", "The Stranger", "Albert Camus", "9780679720201", "Mother died today."),
  entry("pool-catch-22", "Catch-22", "Joseph Heller", "9780684833392", "It was love at first sight."),
  entry("pool-beloved", "Beloved", "Toni Morrison", "9781400033416", "124 was spiteful."),
  entry("pool-one-hundred-years-of-solitude", "One Hundred Years of Solitude", "Gabriel García Márquez", "9780060883287", "Many years later, as he faced the firing squad, Colonel Aureliano Buendía was to remember that distant afternoon when his father took him to discover ice."),
  entry("pool-charlottes-web", "Charlotte's Web", "E. B. White", "9780064400558", "Where's Papa going with that ax?"),
  entry("pool-mrs-dalloway", "Mrs Dalloway", "Virginia Woolf", "9780156628709", "Mrs Dalloway said she would buy the flowers herself."),
  entry("pool-a-christmas-carol", "A Christmas Carol", "Charles Dickens", "9780140439304", "Marley was dead: to begin with."),
  entry("pool-frankenstein", "Frankenstein", "Mary Shelley", "9780141439471", "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings."),
  entry("pool-dracula", "Dracula", "Bram Stoker", "9780141439846", "3 May. Bistritz. Left Munich at 8:35 P.M."),
  entry("pool-dorian-gray", "The Picture of Dorian Gray", "Oscar Wilde", "9780141439570", "The studio was filled with the rich odour of roses."),
  entry("pool-crime-and-punishment", "Crime and Punishment", "Fyodor Dostoevsky", "9780143058144", "On an exceptionally hot evening early in July a young man came out of the garret in which he lodged."),
  entry("pool-war-and-peace", "War and Peace", "Leo Tolstoy", "9781400079988", "\"Eh bien, mon prince.\""),
  entry("pool-don-quixote", "Don Quixote", "Miguel de Cervantes", "9780060934347", "In a village of La Mancha, the name of which I have no desire to call to mind."),
  entry("pool-jane-eyre", "Jane Eyre", "Charlotte Brontë", "9780141441146", "There was no possibility of taking a walk that day."),
  entry("pool-wuthering-heights", "Wuthering Heights", "Emily Brontë", "9780141439556", "1801. I have just returned from a visit to my landlord."),
  entry("pool-sherlock-holmes", "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "9780142437339", "To Sherlock Holmes she is always the woman.")
];
