# Builds data/demo.xlsx from the official template: every tricky case the judges are likely to test.
import sys, openpyxl
src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src)
A = [
 ("APP-001","Ananya Rao","Bengaluru","Karnataka",560043,45,6,"Runs two optical stores in Kalyan Nagar","Rented",650,"Ground",3,"English","Has a trained staff of 4"),
 ("APP-002","Mohammed Irfan","Bengaluru","Karnataka",560095,30,2,"Mobile accessories shop","Owned",400,"Upper",4,"Hindi","Wants to open before Diwali"),
 ("APP-003","Kavya Shetty","Bengaluru","Karnataka",560038,50,8,"Store manager at a footwear chain","Rented",800,"Ground",2,"Kannada","Shop is on 100 Feet Road"),
 ("APP-004","Rahul Jain","Bengaluru","Karnataka",560008,60,10,"Family runs a garment showroom","Owned",1200,"Ground",3,"Hindi","Brother will co-invest"),
 ("APP-005","Deepa N","Bengaluru","Karnataka",560078,35,4,"Ran a boutique for 4 years","Rented",500,"Ground",5,"Kannada",""),
 ("APP-006","Suresh Gowda","Bengaluru","Karnataka",560078,40,3,"Kirana store owner","Owned",450,"Ground",4,"Kannada","Can start immediately"),
 ("APP-007","Priya Menon","Mysuru","Karnataka",570002,None,5,"Manages a pharmacy","Rented",500,"Ground",3,"English","Will share funds after talking to bank"),
 ("APP-008","Arjun Hegde","Mysuru","Karnataka",570001,28,5,"Electronics retail","Rented",550,"Ground",3,None,""),
 ("APP-009","Lakshmi Prasad","Mysuru","Karnataka",570008,20,0,"Homemaker, first business","Not yet identified",None,"Not known",6,"Kannada","Will find a shop near Devaraja market; husband will support"),
 ("APP-010","Vikram Singh","Mysuru","Karnataka",570009,35,7,"Runs a sports goods shop","Rented",600,"Ground",3,"Hindi",""),
 ("APP-011","Nandini K","Mysuru","Karnataka",570020,12,1,"Tailoring shop","Rented",300,"Upper",8,"Kannada","Need a bank loan for the rest"),
 ("APP-012","Sanjay Patil","Hubballi-Dharwad","Karnataka",580021,32,6,"Runs a watch and optical counter","Not yet identified",None,"Not known",3,"Kannada","Looking at shops on Deshpande Nagar main road"),
 ("APP-013","Fatima Begum","Hubballi-Dharwad","Karnataka",580029,22,2,"Cosmetics shop","Rented",350,"Upper",6,"Hindi",""),
 ("APP-014","Rohan D'Souza","Mangaluru","Karnataka",575003,40,12,"Ran a supermarket for 12 years","Owned",900,"Mall unit",None,"English","Interested in a second store later"),
 ("APP-015","Meera Kulkarni","Belagavi","Karnataka",590006,38,5,"Apparel retail","Rented",600,"Ground",3,"Kannada",""),
 ("APP-016","Imran Khan","Mysuru","Karnataka",575006,30,4,"Footwear dealer","Rented",500,"Ground",4,"Hindi",""),
 ("APP-017","Sneha Reddy","Bengaluru","Karnataka",560102,45,4,"Cafe owner","Rented",700,"Ground",3,"English",""),
 ("APP-018","Harish Babu","Tumakuru","Karnataka",572101,25,3,"Runs a stationery shop","Owned",None,"Ground",3,"Kannada",""),
 ("APP-019","Pooja Agarwal","Davanagere","Karnataka",577001,30,5,"Textile shop","Rented",500,"Ground",4,"Hindi",""),
 ("APP-020","Ganesh Murthy","Tumakuru","Karnataka",572102,26,"4 yrs","Hardware store","Not yet identified",400,"Ground",5,"Kannada","Shop near bus stand"),
 ("APP-021","Bhavana S","Davanagere","Karnataka",577004,15,0,"Recently graduated","Rented",200,"Upper",12,"Kannada","Not sure yet, maybe with a friend"),
 ("APP-022","Mohammed Irfan","Bengaluru","Karnataka",560095,32,2,"Mobile accessories shop","Owned",400,"Upper",4,"Hindi","Resubmitting with updated investment"),
 ("APP-023","Kiran Rao","Mysuru","Karnataka",570002,33,4,"Runs a gift shop","Rented",450,"Ground",3,"English",""),
 ("APP-024","Ramesh Naik","Tumakuru","Karnataka",572103,0,10,"Retired shop owner","Owned",600,"Ground",4,"Kannada","Son works in IT and will fund"),
]
T = [
 ("TER-01","Bengaluru","Karnataka","560008, 560038, 560043, 560095, 560102","Tier 1",2,"High"),
 ("TER-02","Bengaluru","Karnataka","560076, 560078, 560041, 560068","Tier 1",1,"Medium"),
 ("TER-03","Mysuru","Karnataka","570001, 570002, 570008, 570020","Tier 2",3,"High"),
 ("TER-04","Mangaluru","Karnataka","575002, 575003, 575006","Tier 2",1,"Medium"),
 ("TER-05","Hubballi-Dharwad","Karnataka","580021, 580029, 580031","Tier 2",1,"High"),
 ("TER-06","Belagavi","Karnataka","590006, 590010","Tier 2",0,"Low"),
 ("TER-07","Tumakuru","Karnataka","572101, 572102, 572103","Tier 3",1,"Medium"),
 ("TER-08","Bengaluru","Karnataka","560102, 560103, 560109","Tier 1",1,"Low"),
 ("TER-09","Davanagere","Karnataka","577002, 577004, 577006","Tier 3",2,"Low"),
]
def fill(ws, rows):
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            ws.cell(row=4+i, column=1+j, value=v)
fill(wb["Applications"], A); fill(wb["Territories"], T)
wb.save(dst); print("ok", len(A), len(T))
