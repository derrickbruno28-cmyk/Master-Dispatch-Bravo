/* NCAA Division I football teams for the morale badge (Caleb 07/09).
   Owner toggles the feature (settings/morale.enabled); each user picks their
   own team. "Logo" images are resolved at pick time from Wikipedia's REST API
   (page summary thumbnail of the athletics-program article — the standardized
   "sorter" Caleb asked for) and cached on the user doc; a team-colored
   monogram renders until/unless a logo URL resolves. Colors are each program's
   primary; the badge always sits on a fixed light chip so any color reads on
   both themes. Roughly the full D1 membership (FBS + FCS) — additions are one
   line here. */

export interface Team {
  key: string;
  name: string; // "Texas Longhorns" — also the Wikipedia article title
  color: string;
}

const T: Array<[string, string]> = [
  // ---- FBS ----
  ['Air Force Falcons', '#003087'], ['Akron Zips', '#041E42'], ['Alabama Crimson Tide', '#9E1B32'],
  ['Appalachian State Mountaineers', '#FFCC00'], ['Arizona Wildcats', '#CC0033'], ['Arizona State Sun Devils', '#8C1D40'],
  ['Arkansas Razorbacks', '#9D2235'], ['Arkansas State Red Wolves', '#CC092F'], ['Army Black Knights', '#D4BF91'],
  ['Auburn Tigers', '#0C2340'], ['Ball State Cardinals', '#BA0C2F'], ['Baylor Bears', '#154734'],
  ['Boise State Broncos', '#0033A0'], ['Boston College Eagles', '#98002E'], ['Bowling Green Falcons', '#FE5000'],
  ['Buffalo Bulls', '#005BBB'], ['BYU Cougars', '#002E5D'], ['California Golden Bears', '#003262'],
  ['Central Michigan Chippewas', '#6A0032'], ['Charlotte 49ers', '#046A38'], ['Cincinnati Bearcats', '#E00122'],
  ['Clemson Tigers', '#F56600'], ['Coastal Carolina Chanticleers', '#006F71'], ['Colorado Buffaloes', '#CFB87C'],
  ['Colorado State Rams', '#1E4D2B'], ['Delaware Blue Hens', '#00539F'], ['Duke Blue Devils', '#003087'],
  ['East Carolina Pirates', '#592A8A'], ['Eastern Michigan Eagles', '#046A38'], ['FIU Panthers', '#081E3F'],
  ['Florida Gators', '#0021A5'], ['Florida Atlantic Owls', '#003366'], ['Florida State Seminoles', '#782F40'],
  ['Fresno State Bulldogs', '#DB0032'], ['Georgia Bulldogs', '#BA0C2F'], ['Georgia Southern Eagles', '#041E42'],
  ['Georgia State Panthers', '#0039A6'], ['Georgia Tech Yellow Jackets', '#B3A369'], ['Hawaii Rainbow Warriors', '#024731'],
  ['Houston Cougars', '#C8102E'], ['Illinois Fighting Illini', '#E84A27'], ['Indiana Hoosiers', '#990000'],
  ['Iowa Hawkeyes', '#FFCD00'], ['Iowa State Cyclones', '#C8102E'], ['Jacksonville State Gamecocks', '#CC0000'],
  ['James Madison Dukes', '#450084'], ['Kansas Jayhawks', '#0051BA'], ['Kansas State Wildcats', '#512888'],
  ['Kennesaw State Owls', '#FDBB30'], ['Kent State Golden Flashes', '#002664'], ['Kentucky Wildcats', '#0033A0'],
  ['Liberty Flames', '#002D62'], ['Louisiana Ragin’ Cajuns', '#CE181E'], ['Louisiana Tech Bulldogs', '#002F8B'],
  ['Louisiana–Monroe Warhawks', '#840029'], ['Louisville Cardinals', '#AD0000'], ['LSU Tigers', '#461D7C'],
  ['Marshall Thundering Herd', '#00B140'], ['Maryland Terrapins', '#E03A3E'], ['Memphis Tigers', '#003087'],
  ['Miami Hurricanes', '#F47321'], ['Miami RedHawks', '#B61E2E'], ['Michigan Wolverines', '#00274C'],
  ['Michigan State Spartans', '#18453B'], ['Middle Tennessee Blue Raiders', '#0066CC'], ['Minnesota Golden Gophers', '#7A0019'],
  ['Mississippi State Bulldogs', '#660000'], ['Missouri Tigers', '#F1B82D'], ['Missouri State Bears', '#5E0009'],
  ['Navy Midshipmen', '#00205B'], ['NC State Wolfpack', '#CC0000'], ['Nebraska Cornhuskers', '#E41C38'],
  ['Nevada Wolf Pack', '#041E42'], ['New Mexico Lobos', '#BA0C2F'], ['New Mexico State Aggies', '#8C0B42'],
  ['North Carolina Tar Heels', '#7BAFD4'], ['North Texas Mean Green', '#00853E'], ['Northern Illinois Huskies', '#C8102E'],
  ['Northwestern Wildcats', '#4E2A84'], ['Notre Dame Fighting Irish', '#0C2340'], ['Ohio Bobcats', '#00694E'],
  ['Ohio State Buckeyes', '#BB0000'], ['Oklahoma Sooners', '#841617'], ['Oklahoma State Cowboys', '#FF7300'],
  ['Old Dominion Monarchs', '#003057'], ['Ole Miss Rebels', '#CE1126'], ['Oregon Ducks', '#154733'],
  ['Oregon State Beavers', '#DC4405'], ['Penn State Nittany Lions', '#041E42'], ['Pittsburgh Panthers', '#003594'],
  ['Purdue Boilermakers', '#CEB888'], ['Rice Owls', '#00205B'], ['Rutgers Scarlet Knights', '#CC0033'],
  ['Sam Houston Bearkats', '#F56423'], ['San Diego State Aztecs', '#A6192E'], ['San Jose State Spartans', '#0055A2'],
  ['SMU Mustangs', '#0033A0'], ['South Alabama Jaguars', '#00205B'], ['South Carolina Gamecocks', '#73000A'],
  ['South Florida Bulls', '#006747'], ['Southern Miss Golden Eagles', '#FFAB00'], ['Stanford Cardinal', '#8C1515'],
  ['Syracuse Orange', '#D44500'], ['TCU Horned Frogs', '#4D1979'], ['Temple Owls', '#9D2235'],
  ['Tennessee Volunteers', '#FF8200'], ['Texas Longhorns', '#BF5700'], ['Texas A&M Aggies', '#500000'],
  ['Texas State Bobcats', '#501214'], ['Texas Tech Red Raiders', '#CC0000'], ['Toledo Rockets', '#15397F'],
  ['Troy Trojans', '#8A2432'], ['Tulane Green Wave', '#006747'], ['Tulsa Golden Hurricane', '#002D72'],
  ['UAB Blazers', '#1E6B52'], ['UCF Knights', '#FFC904'], ['UCLA Bruins', '#2D68C4'],
  ['UConn Huskies', '#000E2F'], ['UMass Minutemen', '#881C1C'], ['UNLV Rebels', '#CF0A2C'],
  ['USC Trojans', '#990000'], ['Utah Utes', '#CC0000'], ['Utah State Aggies', '#00263A'],
  ['UTEP Miners', '#FF8200'], ['UTSA Roadrunners', '#F15A22'], ['Vanderbilt Commodores', '#A8996E'],
  ['Virginia Cavaliers', '#232D4B'], ['Virginia Tech Hokies', '#630031'], ['Wake Forest Demon Deacons', '#9E7E38'],
  ['Washington Huskies', '#4B2E83'], ['Washington State Cougars', '#981E32'], ['West Virginia Mountaineers', '#002855'],
  ['Western Kentucky Hilltoppers', '#C60C30'], ['Western Michigan Broncos', '#6C4023'], ['Wisconsin Badgers', '#C5050C'],
  ['Wyoming Cowboys', '#FFC425'],
  // ---- FCS ----
  ['Abilene Christian Wildcats', '#4E2683'], ['Alabama A&M Bulldogs', '#660000'], ['Alabama State Hornets', '#C99700'],
  ['Albany Great Danes', '#46166B'], ['Alcorn State Braves', '#46166B'], ['Arkansas–Pine Bluff Golden Lions', '#FDB913'],
  ['Austin Peay Governors', '#C8102E'], ['Bethune–Cookman Wildcats', '#841617'], ['Brown Bears', '#4E3629'],
  ['Bryant Bulldogs', '#A89968'], ['Bucknell Bison', '#003865'], ['Butler Bulldogs', '#13294B'],
  ['Cal Poly Mustangs', '#154734'], ['Campbell Fighting Camels', '#EA7125'], ['Central Arkansas Bears', '#4F2D7F'],
  ['Central Connecticut Blue Devils', '#1B49A2'], ['Charleston Southern Buccaneers', '#002F6C'], ['Chattanooga Mocs', '#00386B'],
  ['Colgate Raiders', '#821019'], ['Columbia Lions', '#B9D9EB'], ['Cornell Big Red', '#B31B1B'],
  ['Dartmouth Big Green', '#00693E'], ['Davidson Wildcats', '#AC1A2F'], ['Dayton Flyers', '#CE1141'],
  ['Delaware State Hornets', '#E32526'], ['Drake Bulldogs', '#004477'], ['Duquesne Dukes', '#041E42'],
  ['East Tennessee State Buccaneers', '#041E42'], ['Eastern Illinois Panthers', '#004B83'], ['Eastern Kentucky Colonels', '#861F41'],
  ['Eastern Washington Eagles', '#A10022'], ['Elon Phoenix', '#73000A'], ['Florida A&M Rattlers', '#F89728'],
  ['Fordham Rams', '#900028'], ['Furman Paladins', '#582C83'], ['Gardner–Webb Runnin’ Bulldogs', '#BB0000'],
  ['Georgetown Hoyas', '#041E42'], ['Grambling State Tigers', '#ECAA00'], ['Hampton Pirates', '#0067AC'],
  ['Harvard Crimson', '#A51C30'], ['Holy Cross Crusaders', '#602D89'], ['Houston Christian Huskies', '#00539C'],
  ['Howard Bison', '#003A63'], ['Idaho Vandals', '#B3A369'], ['Idaho State Bengals', '#F47920'],
  ['Illinois State Redbirds', '#CE1126'], ['Incarnate Word Cardinals', '#CB333B'], ['Indiana State Sycamores', '#00669A'],
  ['Jackson State Tigers', '#002147'], ['Lafayette Leopards', '#98002E'], ['Lamar Cardinals', '#E1251B'],
  ['Lehigh Mountain Hawks', '#653819'], ['Lindenwood Lions', '#A6192E'], ['LIU Sharks', '#002D62'],
  ['Maine Black Bears', '#003263'], ['Marist Red Foxes', '#C8102E'], ['McNeese Cowboys', '#00529B'],
  ['Mercer Bears', '#F76800'], ['Mercyhurst Lakers', '#00563F'], ['Merrimack Warriors', '#002F6C'],
  ['Monmouth Hawks', '#041E42'], ['Montana Grizzlies', '#70002E'], ['Montana State Bobcats', '#00205B'],
  ['Morehead State Eagles', '#005EB8'], ['Morgan State Bears', '#F47937'], ['Murray State Racers', '#002144'],
  ['New Hampshire Wildcats', '#003591'], ['Nicholls Colonels', '#B50938'], ['Norfolk State Spartans', '#007A33'],
  ['North Alabama Lions', '#46166B'], ['North Carolina A&T Aggies', '#004684'], ['North Carolina Central Eagles', '#8A0C04'],
  ['North Dakota Fighting Hawks', '#009A44'], ['North Dakota State Bison', '#005643'], ['Northern Arizona Lumberjacks', '#003466'],
  ['Northern Colorado Bears', '#013C65'], ['Northern Iowa Panthers', '#4B116F'], ['Northwestern State Demons', '#492A84'],
  ['Penn Quakers', '#011F5B'], ['Portland State Vikings', '#154734'], ['Prairie View A&M Panthers', '#4F2D7F'],
  ['Presbyterian Blue Hose', '#0073CF'], ['Princeton Tigers', '#E77500'], ['Rhode Island Rams', '#69B3E7'],
  ['Richmond Spiders', '#990000'], ['Robert Morris Colonials', '#14234B'], ['Sacramento State Hornets', '#043927'],
  ['Sacred Heart Pioneers', '#CE1141'], ['Saint Francis Red Flash', '#EA0029'], ['Sam Houston moved to FBS', ''],
  ['Samford Bulldogs', '#002649'], ['San Diego Toreros', '#003B70'], ['South Carolina State Bulldogs', '#841A2B'],
  ['South Dakota Coyotes', '#CD1241'], ['South Dakota State Jackrabbits', '#0033A0'], ['Southeast Missouri State Redhawks', '#C8102E'],
  ['Southeastern Louisiana Lions', '#006341'], ['Southern Jaguars', '#0072CE'], ['Southern Illinois Salukis', '#720A1E'],
  ['Southern Utah Thunderbirds', '#C8102E'], ['St. Thomas Tommies', '#512D6D'], ['Stephen F. Austin Lumberjacks', '#582C83'],
  ['Stetson Hatters', '#006747'], ['Stonehill Skyhawks', '#582C83'], ['Stony Brook Seawolves', '#990000'],
  ['Tarleton State Texans', '#4F2D7F'], ['Tennessee State Tigers', '#00539F'], ['Tennessee Tech Golden Eagles', '#4F2984'],
  ['Texas A&M–Commerce Lions', '#0038A8'], ['Texas Southern Tigers', '#71090C'], ['The Citadel Bulldogs', '#3975B7'],
  ['Towson Tigers', '#FFBB00'], ['UC Davis Aggies', '#002855'], ['UT Martin Skyhawks', '#002649'],
  ['Utah Tech Trailblazers', '#BA1C21'], ['UTRGV Vaqueros', '#F05023'], ['Valparaiso Beacons', '#613318'],
  ['Villanova Wildcats', '#00205B'], ['VMI Keydets', '#AE122A'], ['Wagner Seahawks', '#004435'],
  ['Weber State Wildcats', '#4B2682'], ['West Georgia Wolves', '#0039A6'], ['Western Carolina Catamounts', '#592C88'],
  ['Western Illinois Leathernecks', '#663399'], ['William & Mary Tribe', '#115740'], ['Wofford Terriers', '#886E4C'],
  ['Yale Bulldogs', '#00356B'], ['Youngstown State Penguins', '#C8102E'],
];

export const TEAMS: Team[] = T
  .filter(([, color]) => !!color) // placeholder rows (conference moves) drop out
  .map(([name, color]) => ({
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    color,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const teamByKey = (key: string | undefined): Team | undefined =>
  key ? TEAMS.find((t) => t.key === key) : undefined;

/** Monogram initials for the colored badge when no logo image has resolved. */
export function teamInitials(name: string): string {
  const words = name.split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** Resolve a logo image URL from Wikipedia's REST summary endpoint — the
    thumbnail of the team's athletics article is (nearly always) the logo.
    Returns '' when nothing resolves; the monogram badge stays. */
export async function fetchTeamLogo(team: Team): Promise<string> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(team.name.replace(/ /g, '_'))}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return '';
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    return data.thumbnail?.source ?? '';
  } catch {
    return '';
  }
}
