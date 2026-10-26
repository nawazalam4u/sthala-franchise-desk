# A deliberately nasty workbook: renamed/reordered sheets, extra columns, blank rows, messy text values.
import sys, openpyxl
wb = openpyxl.Workbook()
t = wb.active; t.title = "Terr"
t.append(["Territories (custom title row)"])
t.append(["Priority", "Territory ID", "City", "State", "Pin codes covered", "City tier", "Open slots", "Extra col"])
for r in [
 ("high", "TER-10", "mysore", "Karnataka", "570001; 570002 ,570008, 57000X", "Tier 2", 1, "x"),
 ("Medium", "TER-11", "Bengaluru", "Karnataka", "560043\n560095", "Tier 1", "two", ""),
 ("Low", "TER-12", "Bengaluru", "Karnataka", "560095, 560102", "Tier 1", 2, ""),
 ("High", "TER-13", "Tumakuru", "Karnataka", "572101", "Tier 3", 0, ""),
]: t.append(r)
a = wb.create_sheet("Apps", 0)
a.append(["Please fill"]); a.append([])
a.append(["Notes from applicant", "Application ID", "Applicant name", "City", "State", "Pin code", "Investment capacity (₹ lakh)", "Retail experience (years)", "Current / past business", "Space available", "Space size (sq ft)", "Floor", "Target launch (months)", "Preferred language", "Random"])
rows = [
 ("", "app-101", "Asha", "Mysuru", "Karnataka", "570 001", "25 lakhs", "4", "Footwear", "rent", "450", "ground floor", 3, "kannada", 1),
 ("", "APP-102", "Bala", "Mysuru", "Karnataka", 570001.0, "1.2 crore", 2, "Bakery", "Owned", 600, "Ground", 3, "Hindi", 1),
 ("", "APP-103", "Chitra", "Mysuru", "Karnataka", 570002, 30, "five", "Kirana", "Rented", 500, "Ground", 3, "English", 1),
 ("", "APP-104", "Dev", "Mysuru", "Karnataka", 570008, 30, 60, "Kirana", "Rented", 500, "Ground", -2, "Tamil", 1),
 None,
 ("", "APP-105", "Esha", "Bengaluru", "Karnataka", 560095, 40, 5, "Apparel", "Rented", 700, "first floor", 4, "English", 1),
 ("", "APP-105", "Esha dup", "Bengaluru", "Karnataka", 560043, 40, 5, "Apparel", "Rented", 700, "Ground", 4, "English", 1),
 ("", "APP-106", "", "Bengaluru", "Karnataka", 560102, 35, 3, "", "Rented", 400, "Mall", 4, "", 1),
 ("", "", "No ID person", "Bengaluru", "Karnataka", 560102, 35, 3, "", "Rented", 400, "Ground", 4, "", 1),
 ("", "APP-107", "Faiz", "Tumakuru", "Karnataka", 572101, 25, 3, "Shop", "Owned", 400, "Ground", 3, "Hindi", 1),
 ("Already have a franchise of another eyewear brand", "APP-108", "Gita", "Belagavi", "Karnataka", 590001, "", 2, "Optician", "Not yet identified", "", "Not known", "", "Kannada", 1),
 ("", "APP-109", "Hari", "Davanagere", "Karnataka", "57700", 20, 2, "Shop", "Rented", 300, "Ground", 2, "Kannada", 1),
 ("", "APP-110", "Indu", "Mysuru", "Karnataka", 570002, 30, 4, "Kirana", "Rented", 500, "Ground", 3, "English", 1),
 ("", "APP-111", "Jai", "Mysuru", "Karnataka", 570002, 30, 4, "Kirana", "Rented", 500, "Ground", 3, "English", 1),
]
for r in rows: a.append(list(r) if r else [])
s = wb.create_sheet("Stores")
s.append(["Store ID", "City", "Pin code", "Opened (year)"])
for r in [("ST-01","Bengaluru",560001,2019),("ST-02","Bengaluru",560034,2020),("ST-03","Bengaluru",560038,2021),("ST-04","Bengaluru",560066,2022),("ST-05","Bengaluru",560076,2023),("ST-06","Mysuru",570009,2021),("ST-07","Mysuru",570017,2024),("ST-08","Mangaluru",575001,2022),("ST-09","Hubballi-Dharwad",580020,2023),("ST-10","Belagavi",590001,2024)]: s.append(r)
wb.save(sys.argv[1]); print("ok")
