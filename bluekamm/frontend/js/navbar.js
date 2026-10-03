async function loadNavbar() {
    const navbar = document.getElementById("navbar");

    if (!navbar) {
        console.error("Navbar container not found!");
        return;
    }

    try {
        const response = await fetch("components/navbar.html");

        if (!response.ok) {
            throw new Error("Navbar file not found");
        }

        const navbarHTML = await response.text();

        navbar.innerHTML = navbarHTML;

        console.log("Navbar loaded successfully!");

    } catch (error) {
        console.error("Navbar Error:", error);
    }
}

loadNavbar();


function toggleMenu() {
    const mobileMenu = document.getElementById("mobileMenu");

    if (mobileMenu) {
        mobileMenu.classList.toggle("active");
    }
}