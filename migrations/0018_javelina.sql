-- Javelina gets its own species checkbox. Subscribers who already followed "Other" (where javelina
-- alerts went before) or every species keep getting them.
UPDATE subscribers SET species = species || ',javelina' WHERE species != '*' AND (',' || species || ',') LIKE '%,other,%' AND (',' || species || ',') NOT LIKE '%,javelina,%';
UPDATE sources SET species = 'elk,deer,pronghorn,bear,turkey,sheep,javelina' WHERE id = 'az-leftover';
